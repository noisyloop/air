import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { nanoid } from 'nanoid';
import type { AudioFormat, Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma.js';
import { getObjectStream, putObject, BUCKETS } from '../../shared/s3.js';
import { indexQueue, notifyQueue, type AudioJobData } from '../../shared/queue.js';
import { hasPermission, PERMISSIONS, type PermissionKey } from '../../shared/rbac.js';
import { extractWaveformPeaks, ffmpegAvailable, measureLoudness, runFfmpeg, runFfprobeJson } from '../ffmpeg.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

interface UploadMeta {
  title: string;
  albumTitle: string;
  albumType?: 'ALBUM' | 'SINGLE' | 'EP' | 'COMPILATION';
  trackNumber?: number;
  genres?: string[];
  explicit?: boolean;
  releaseDate?: string;
}

const ENCODES: Array<{ format: AudioFormat; bitrateKbps: number; args: (out: string) => string[] }> = [
  { format: 'AAC', bitrateKbps: 320, args: (o) => ['-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', o] },
  { format: 'AAC', bitrateKbps: 192, args: (o) => ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', o] },
  { format: 'AAC', bitrateKbps: 96, args: (o) => ['-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', o] },
  { format: 'OPUS', bitrateKbps: 128, args: (o) => ['-c:a', 'libopus', '-b:a', '128k', o] },
];

async function downloadToTmp(bucket: string, key: string, dir: string): Promise<string> {
  const { body } = await getObjectStream(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  const file = path.join(dir, `original${path.extname(key) || '.bin'}`);
  await writeFile(file, Buffer.concat(chunks));
  return file;
}

/**
 * Full pipeline for one uploaded file:
 * probe metadata → loudness → waveform → transcode variants → artwork →
 * create Track/TrackFile/AudioVariant rows → status + follow-up jobs.
 */
export async function processAudioJob(data: AudioJobData): Promise<void> {
  const job = await prisma.uploadJob.findUnique({ where: { id: data.uploadJobId }, include: { user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } } });
  if (!job) throw new Error(`UploadJob ${data.uploadJobId} not found`);
  if (job.status !== 'UPLOADED' && job.status !== 'PROCESSING') return; // already handled

  await prisma.uploadJob.update({ where: { id: job.id }, data: { status: 'PROCESSING', error: null } });
  const dir = await mkdtemp(path.join(tmpdir(), 'air-audio-'));

  try {
    const original = await downloadToTmp(BUCKETS.uploads, job.objectKey, dir);
    const meta = job.metadata as unknown as UploadMeta;
    const hasFfmpeg = await ffmpegAvailable();

    // ---- metadata (ffprobe with music-metadata fallback) ----
    let durationMs = 0;
    let embeddedArt: { data: Buffer; mime: string } | null = null;
    try {
      const mm = await parseFile(original);
      durationMs = Math.round((mm.format.duration ?? 0) * 1000);
      const pic = mm.common.picture?.[0];
      if (pic) embeddedArt = { data: Buffer.from(pic.data), mime: pic.format };
    } catch {
      /* fall through to ffprobe */
    }
    if (durationMs === 0 && hasFfmpeg) {
      const probe = await runFfprobeJson(original).catch(() => null);
      durationMs = Math.round(Number(probe?.format?.duration ?? 0) * 1000);
    }
    if (durationMs === 0) throw new Error('Could not read audio duration — unsupported or corrupt file');

    // ---- analysis ----
    const [loudnessLufs, peaks] = hasFfmpeg
      ? await Promise.all([measureLoudness(original), extractWaveformPeaks(original)])
      : [null, null];

    // ---- catalog rows (album find-or-create per artist+title) ----
    const artist = await prisma.artist.findUniqueOrThrow({ where: { id: job.artistId } });
    const albumSlugBase = slugify(`${artist.name} ${meta.albumTitle}`);
    let album = await prisma.album.findFirst({ where: { artistId: artist.id, title: meta.albumTitle } });
    if (!album) {
      album = await prisma.album.create({
        data: {
          artistId: artist.id,
          title: meta.albumTitle,
          slug: `${albumSlugBase}-${nanoid(4).toLowerCase()}`,
          type: meta.albumType ?? 'SINGLE',
          releaseDate: meta.releaseDate ? new Date(meta.releaseDate) : new Date(),
        },
      });
    }

    // ---- artwork (embedded picture → art bucket, multiple "sizes") ----
    if (embeddedArt && !(await prisma.albumArt.findFirst({ where: { albumId: album.id } }))) {
      const ext = embeddedArt.mime.includes('png') ? 'png' : 'jpg';
      const baseKey = `covers/${album.slug}`;
      const artSizes: Array<{ size: number; key: string; buf: Buffer }> = [
        { size: 0, key: `${baseKey}/original.${ext}`, buf: embeddedArt.data },
      ];
      if (hasFfmpeg) {
        for (const size of [640, 300, 64]) {
          const srcFile = path.join(dir, `art-src.${ext}`);
          const outFile = path.join(dir, `art-${size}.jpg`);
          await writeFile(srcFile, embeddedArt.data);
          const ok = await runFfmpeg(['-i', srcFile, '-vf', `scale=${size}:${size}`, outFile]).then(
            () => true,
            () => false,
          );
          if (ok) artSizes.push({ size, key: `${baseKey}/${size}.jpg`, buf: await readFile(outFile) });
        }
      }
      for (const a of artSizes) {
        await putObject(BUCKETS.art, a.key, a.buf, a.size === 0 ? embeddedArt.mime : 'image/jpeg');
        await prisma.albumArt.create({
          data: { albumId: album.id, size: a.size, objectKey: a.key, width: a.size || 0, height: a.size || 0 },
        });
      }
    }

    // ---- transcodes ----
    const trackSlug = `${slugify(`${artist.name} ${meta.title}`)}-${nanoid(4).toLowerCase()}`;
    const variants: Array<{ format: AudioFormat; bitrateKbps: number; objectKey: string; sizeBytes: bigint }> = [];
    if (hasFfmpeg) {
      for (const encode of ENCODES) {
        const ext = encode.format === 'AAC' ? 'm4a' : 'ogg';
        const outFile = path.join(dir, `${encode.format}-${encode.bitrateKbps}.${ext}`);
        await runFfmpeg(['-i', original, '-vn', ...encode.args(outFile)]);
        const key = `tracks/${trackSlug}/${encode.format.toLowerCase()}-${encode.bitrateKbps}.${ext}`;
        const buf = await readFile(outFile);
        await putObject(BUCKETS.audio, key, buf, encode.format === 'AAC' ? 'audio/mp4' : 'audio/ogg');
        variants.push({ format: encode.format, bitrateKbps: encode.bitrateKbps, objectKey: key, sizeBytes: BigInt(buf.length) });
      }
    } else {
      // Degraded mode (no ffmpeg): serve the original as a single variant.
      const key = `tracks/${trackSlug}/original${path.extname(job.objectKey) || '.bin'}`;
      const buf = await readFile(original);
      const format: AudioFormat = job.declaredMime.includes('mpeg')
        ? 'MP3'
        : job.declaredMime.includes('ogg')
          ? 'OPUS'
          : job.declaredMime.includes('mp4') || job.declaredMime.includes('aac')
            ? 'AAC'
            : 'WAV';
      await putObject(BUCKETS.audio, key, buf, job.declaredMime);
      variants.push({
        format,
        bitrateKbps: Math.max(1, Math.round((buf.length * 8) / Math.max(1, durationMs))),
        objectKey: key,
        sizeBytes: BigInt(buf.length),
      });
    }

    // ---- waveform ----
    let waveformKey: string | null = null;
    if (peaks) {
      waveformKey = `tracks/${trackSlug}/waveform.json`;
      await putObject(BUCKETS.audio, waveformKey, Buffer.from(JSON.stringify({ peaks })), 'application/json');
    }

    // ---- publish decision: admins go live immediately, artists await approval ----
    const perms = job.user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key as PermissionKey));
    const autoPublish = hasPermission({ sub: job.userId, roles: [], perms }, PERMISSIONS.adminUploads);

    const genres = meta.genres?.length
      ? await prisma.genre.findMany({ where: { slug: { in: meta.genres.map(slugify) } } })
      : [];
    const originalBuf = await stat(original);

    const track = await prisma.track.create({
      data: {
        albumId: album.id,
        artistId: artist.id,
        title: meta.title,
        slug: trackSlug,
        trackNumber: meta.trackNumber ?? 1,
        durationMs,
        explicit: meta.explicit ?? false,
        loudnessLufs,
        waveformKey,
        publishedAt: autoPublish ? new Date() : null,
        genres: { create: genres.map((g) => ({ genreId: g.id })) },
        files: {
          create: [
            {
              objectKey: job.objectKey,
              mimeType: job.declaredMime,
              sizeBytes: BigInt(originalBuf.size),
              sha256: createHash('sha256').update(await readFile(original)).digest('hex'),
            },
          ],
        },
        variants: { create: variants },
      },
    });

    await prisma.uploadJob.update({
      where: { id: job.id },
      data: { trackId: track.id, status: autoPublish ? 'READY' : 'AWAITING_APPROVAL', error: null },
    });

    if (autoPublish) {
      await indexQueue.add('track', { entity: 'track', id: track.id });
      await notifyQueue.add('new_release', {
        kind: 'new_release',
        payload: { trackId: track.id, artistId: artist.id },
      });
    }
    // Tell the uploader processing finished.
    await notifyQueue.add('upload_status', {
      kind: 'upload_status',
      payload: {
        userId: job.userId,
        uploadJobId: job.id,
        status: autoPublish ? 'READY' : 'AWAITING_APPROVAL',
        title: meta.title,
      },
    });
  } catch (err) {
    await prisma.uploadJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: err instanceof Error ? err.message.slice(0, 900) : 'processing failed' },
    });
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

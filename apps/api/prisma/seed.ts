/**
 * Seed + mock data generator.
 *
 * Creates roles/permissions, demo accounts, and a faker-generated catalog with
 * placeholder audio (pure-Node generated WAV tones — CC0, no external assets).
 * Scale with SEED_SCALE (default 1). Safe to re-run: it wipes catalog data first.
 */
import { faker } from '@faker-js/faker';
import argon2 from 'argon2';
import { PrismaClient, AlbumType, PlaySource, FavoriteType } from '@prisma/client';
import { putObject, BUCKETS } from '../src/shared/s3.js';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/shared/rbac.js';

const prisma = new PrismaClient();
const SCALE = Number(process.env.SEED_SCALE ?? 1);
faker.seed(4242);

const GENRES = ['Ambient', 'Electronic', 'Indie Rock', 'Jazz', 'Hip-Hop', 'Classical', 'Folk', 'Synthwave'];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Generate a mono 16-bit PCM WAV of layered sine tones — placeholder audio. */
function generateToneWav(durationSec: number, baseFreq: number): Buffer {
  const sampleRate = 22050;
  const samples = Math.floor(durationSec * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.5, (durationSec - t) / 0.5); // fade in/out
    const v =
      0.35 * Math.sin(2 * Math.PI * baseFreq * t) +
      0.2 * Math.sin(2 * Math.PI * baseFreq * 1.5 * t) +
      0.12 * Math.sin(2 * Math.PI * baseFreq * 0.5 * t + Math.sin(t * 0.7));
    data.writeInt16LE(Math.round(v * env * 32767 * 0.6), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Tiny SVG cover art, uploaded to the public art bucket. */
function generateCoverSvg(title: string, hue: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue},70%,45%)"/>
    <stop offset="100%" stop-color="hsl(${(hue + 80) % 360},70%,20%)"/>
  </linearGradient></defs>
  <rect width="640" height="640" fill="url(#g)"/>
  <circle cx="480" cy="160" r="90" fill="hsla(${(hue + 40) % 360},80%,70%,0.35)"/>
  <text x="40" y="580" font-family="sans-serif" font-size="42" font-weight="bold" fill="white" opacity="0.9">${title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</text>
</svg>`;
  return Buffer.from(svg);
}

async function trySeedObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<boolean> {
  try {
    await putObject(bucket, key, body, contentType);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('Seeding air database…');

  // ---- wipe (dependency order handled by cascades) ----
  await prisma.$transaction([
    prisma.dailyStat.deleteMany(),
    prisma.searchQuery.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.uploadJob.deleteMany(),
    prisma.history.deleteMany(),
    prisma.listeningSession.deleteMany(),
    prisma.favorite.deleteMany(),
    prisma.follow.deleteMany(),
    prisma.playlist.deleteMany(),
    prisma.track.deleteMany(),
    prisma.album.deleteMany(),
    prisma.artist.deleteMany(),
    prisma.genre.deleteMany(),
    prisma.user.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.role.deleteMany(),
  ]);

  // ---- roles & permissions ----
  const permRows = await Promise.all(
    Object.values(PERMISSIONS).map((key) => prisma.permission.create({ data: { key } })),
  );
  const permByKey = new Map(permRows.map((p) => [p.key, p.id]));
  const roles: Record<string, string> = {};
  for (const [name, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.create({
      data: {
        name,
        permissions: { create: keys.map((k) => ({ permissionId: permByKey.get(k)! })) },
      },
    });
    roles[name] = role.id;
  }

  // ---- demo users ----
  const passwordHash = await argon2.hash('password123');
  const mkUser = (email: string, displayName: string, roleNames: string[]) =>
    prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash,
        roles: { create: roleNames.map((r) => ({ roleId: roles[r]! })) },
      },
    });
  const admin = await mkUser('admin@air.local', 'Air Admin', ['admin']);
  const listener = await mkUser('listener@air.local', 'Casual Listener', ['listener']);
  const artistUser = await mkUser('artist@air.local', 'Nova Waves', ['listener', 'artist']);
  const extraUsers = [];
  for (let i = 0; i < 12 * SCALE; i++) {
    extraUsers.push(
      await mkUser(faker.internet.email().toLowerCase(), faker.person.fullName(), ['listener']),
    );
  }
  const allListeners = [listener, artistUser, ...extraUsers];

  // ---- genres ----
  const genreRows = await Promise.all(
    GENRES.map((name) => prisma.genre.create({ data: { name, slug: slugify(name) } })),
  );

  // ---- artists / albums / tracks ----
  const artistNames = new Set<string>();
  const artists = [];
  const artistCount = 10 * SCALE;
  for (let i = 0; i < artistCount; i++) {
    let name = i === 0 ? 'Nova Waves' : `${faker.word.adjective()} ${faker.word.noun()}`;
    name = name.replace(/\b\w/g, (c) => c.toUpperCase());
    if (artistNames.has(name)) name = `${name} ${faker.number.int({ max: 99 })}`;
    artistNames.add(name);
    const genres = faker.helpers.arrayElements(genreRows, { min: 1, max: 3 });
    const artist = await prisma.artist.create({
      data: {
        name,
        slug: slugify(name),
        bio: faker.lorem.paragraph(),
        verified: faker.datatype.boolean(0.6),
        ownerUserId: i === 0 ? artistUser.id : undefined,
        genres: { create: genres.map((g) => ({ genreId: g.id })) },
      },
    });
    artists.push({ artist, genres });
  }

  const tracks: { id: string; durationMs: number }[] = [];
  let toneIdx = 0;
  for (const { artist, genres } of artists) {
    const albumCount = faker.number.int({ min: 1, max: 3 });
    for (let a = 0; a < albumCount; a++) {
      const title = `${faker.word.adjective()} ${faker.word.noun()}`.replace(/\b\w/g, (c) => c.toUpperCase());
      const slug = `${slugify(`${artist.name} ${title}`)}-${faker.string.alphanumeric(4).toLowerCase()}`;
      const type = faker.helpers.arrayElement([AlbumType.ALBUM, AlbumType.ALBUM, AlbumType.EP, AlbumType.SINGLE]);
      const trackCount = type === AlbumType.SINGLE ? 1 : type === AlbumType.EP ? 4 : faker.number.int({ min: 6, max: 10 });

      const artKey = `covers/${slug}/640.svg`;
      const hasArt = await trySeedObject(
        BUCKETS.art,
        artKey,
        generateCoverSvg(title, faker.number.int({ max: 359 })),
        'image/svg+xml',
      );

      const album = await prisma.album.create({
        data: {
          artistId: artist.id,
          title,
          slug,
          type,
          releaseDate: faker.date.past({ years: 6 }),
          popularity: faker.number.int({ max: 100 }),
          genres: { create: genres.map((g) => ({ genreId: g.id })) },
          art: hasArt ? { create: [{ size: 640, objectKey: artKey, width: 640, height: 640 }] } : undefined,
        },
      });

      for (let t = 1; t <= trackCount; t++) {
        const trackTitle = `${faker.word.adjective()} ${faker.word.noun()}`.replace(/\b\w/g, (c) => c.toUpperCase());
        const durationSec = faker.number.int({ min: 20, max: 40 }); // short placeholder tones
        const audioKey = `seed/${slug}-${t}.wav`;
        const wav = generateToneWav(durationSec, 110 * Math.pow(2, (toneIdx++ % 24) / 12));
        const hasAudio = await trySeedObject(BUCKETS.audio, audioKey, wav, 'audio/wav');

        const track = await prisma.track.create({
          data: {
            albumId: album.id,
            artistId: artist.id,
            title: trackTitle,
            slug: `${slugify(`${artist.name} ${trackTitle}`)}-${faker.string.alphanumeric(4).toLowerCase()}`,
            trackNumber: t,
            durationMs: durationSec * 1000,
            explicit: faker.datatype.boolean(0.1),
            popularity: faker.number.int({ max: 100 }),
            playCount: BigInt(faker.number.int({ max: 250_000 })),
            publishedAt: album.releaseDate,
            loudnessLufs: -14 + faker.number.float({ min: -4, max: 2 }),
            genres: { create: genres.map((g) => ({ genreId: g.id })) },
            variants: hasAudio
              ? { create: [{ format: 'WAV', bitrateKbps: 353, objectKey: audioKey, sizeBytes: BigInt(wav.length) }] }
              : undefined,
          },
        });
        tracks.push({ id: track.id, durationMs: durationSec * 1000 });
      }
    }
  }

  // ---- playlists, favorites, follows, history ----
  for (const u of allListeners) {
    const pl = await prisma.playlist.create({
      data: {
        ownerId: u.id,
        title: `${faker.word.adjective()} mix`.replace(/\b\w/, (c) => c.toUpperCase()),
        description: faker.lorem.sentence(),
        isPublic: faker.datatype.boolean(0.7),
        isCollaborative: faker.datatype.boolean(0.2),
        tracks: {
          create: faker.helpers
            .arrayElements(tracks, { min: 5, max: 15 })
            .map((t, i) => ({ trackId: t.id, position: i, addedById: u.id })),
        },
      },
    });
    if (u.id === listener.id) {
      const folder = await prisma.libraryFolder.create({ data: { userId: u.id, name: 'Daily rotation' } });
      await prisma.libraryFolderItem.create({ data: { folderId: folder.id, playlistId: pl.id } });
    }

    for (const t of faker.helpers.arrayElements(tracks, { min: 5, max: 20 })) {
      await prisma.favorite.create({ data: { userId: u.id, type: FavoriteType.TRACK, trackId: t.id } });
    }
    for (const { artist } of faker.helpers.arrayElements(artists, { min: 1, max: 4 })) {
      await prisma.follow.create({ data: { followerId: u.id, artistId: artist.id } });
    }
    // 30 days of listening history
    for (let i = 0; i < 40 * SCALE; i++) {
      const t = faker.helpers.arrayElement(tracks);
      const completed = faker.datatype.boolean(0.7);
      await prisma.history.create({
        data: {
          userId: u.id,
          trackId: t.id,
          playedAt: faker.date.recent({ days: 30 }),
          msPlayed: completed ? t.durationMs : faker.number.int({ max: t.durationMs }),
          completed,
          source: faker.helpers.enumValue(PlaySource),
        },
      });
    }
  }

  // ---- trending search + audit seed ----
  for (const q of ['nova', 'jazz', 'ambient', 'mix', 'waves']) {
    for (let i = 0; i < faker.number.int({ min: 2, max: 12 }); i++) {
      await prisma.searchQuery.create({
        data: { query: q, userId: faker.helpers.arrayElement(allListeners).id, resultCount: 5 },
      });
    }
  }
  await prisma.auditLog.create({
    data: { actorId: admin.id, action: 'system.seed', metadata: { tracks: tracks.length } },
  });

  console.log(
    `Seeded: ${artistCount} artists, ${tracks.length} tracks, ${allListeners.length + 1} users. ` +
      `Accounts: admin@air.local, artist@air.local, listener@air.local (password123)`,
  );
  console.log('Run the worker once (or POST /admin/reindex) to build search indexes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

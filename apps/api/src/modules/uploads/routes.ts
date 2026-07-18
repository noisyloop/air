import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { presignPut, headObject, BUCKETS } from '../../shared/s3.js';
import { audioQueue } from '../../shared/queue.js';
import { PERMISSIONS, hasPermission } from '../../shared/rbac.js';
import { audit } from '../../shared/audit.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';

const ALLOWED_MIME = ['audio/wav', 'audio/x-wav', 'audio/flac', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg'];
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const createSchema = z.object({
  artistId: z.string(),
  filename: z.string().min(1).max(200),
  mimeType: z.string().refine((m) => ALLOWED_MIME.includes(m), 'Unsupported audio format'),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  metadata: z.object({
    title: z.string().min(1).max(200),
    albumTitle: z.string().min(1).max(200),
    albumType: z.enum(['ALBUM', 'SINGLE', 'EP', 'COMPILATION']).default('SINGLE'),
    trackNumber: z.number().int().min(1).max(99).default(1),
    genres: z.array(z.string()).max(5).default([]),
    explicit: z.boolean().default(false),
    releaseDate: z.string().date().optional(),
    // The uploader must attest they own distribution rights for this audio.
    rightsAttestation: z.literal(true),
  }),
});

async function assertArtistAccess(userId: string, artistId: string, isAdmin: boolean) {
  const artist = await prisma.artist.findUnique({ where: { id: artistId } });
  if (!artist) throw notFound('Artist not found');
  if (!isAdmin && artist.ownerUserId !== userId) {
    throw forbidden('You can only upload for your own artist profile');
  }
  return artist;
}

export default async function uploadRoutes(app: FastifyInstance) {
  // POST /uploads — create an upload job + signed PUT URL
  app.post('/', { preHandler: app.requirePermission(PERMISSIONS.trackUpload) }, async (req, reply) => {
    const body = parse(createSchema, req.body);
    const isAdmin = hasPermission(req.auth, PERMISSIONS.adminUploads);
    await assertArtistAccess(req.auth!.sub, body.artistId, isAdmin);

    const ext = body.filename.includes('.') ? body.filename.split('.').pop()!.slice(0, 8) : 'bin';
    const objectKey = `incoming/${body.artistId}/${nanoid()}.${ext}`;
    const job = await prisma.uploadJob.create({
      data: {
        userId: req.auth!.sub,
        artistId: body.artistId,
        objectKey,
        originalFilename: body.filename,
        declaredMime: body.mimeType,
        sizeBytes: BigInt(body.sizeBytes),
        metadata: body.metadata,
      },
    });
    const signedUrl = await presignPut(BUCKETS.uploads, objectKey, body.mimeType);
    audit({ actorId: req.auth!.sub, action: 'upload.create', targetType: 'UploadJob', targetId: job.id });
    return reply.status(201).send({ uploadJobId: job.id, signedUrl, expiresIn: 900 });
  });

  // POST /uploads/:id/complete — client finished the PUT; verify & enqueue processing
  app.post('/:id/complete', { preHandler: app.requirePermission(PERMISSIONS.trackUpload) }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const job = await prisma.uploadJob.findUnique({ where: { id } });
    if (!job || job.userId !== req.auth!.sub) throw notFound('Upload job not found');
    if (job.status !== 'PENDING') throw badRequest(`Upload already ${job.status.toLowerCase()}`);

    const head = await headObject(BUCKETS.uploads, job.objectKey).catch(() => null);
    if (!head) throw badRequest('File not found in storage — did the upload finish?', 'UPLOAD_MISSING');
    if ((head.ContentLength ?? 0) > MAX_UPLOAD_BYTES) throw badRequest('File exceeds size limit');

    await prisma.uploadJob.update({
      where: { id },
      data: { status: 'UPLOADED', sizeBytes: BigInt(head.ContentLength ?? 0) },
    });
    await audioQueue.add('process', { uploadJobId: id }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    return { status: 'UPLOADED' };
  });

  // GET /uploads — the caller's upload jobs with processing status
  app.get('/', { preHandler: app.requirePermission(PERMISSIONS.trackUpload) }, async (req) => {
    const q = parse(pageQuerySchema, req.query);
    const where = { userId: req.auth!.sub };
    const [items, total] = await Promise.all([
      prisma.uploadJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { track: { select: { id: true, title: true, slug: true } }, artist: { select: { id: true, name: true } } },
        ...skipTake(q.page, q.limit),
      }),
      prisma.uploadJob.count({ where }),
    ]);
    return toPage(
      items.map((j) => ({
        id: j.id,
        status: j.status,
        originalFilename: j.originalFilename,
        metadata: j.metadata,
        error: j.error,
        artist: j.artist,
        track: j.track,
        createdAt: j.createdAt,
      })),
      total,
      q.page,
      q.limit,
    );
  });

  app.get('/:id', { preHandler: app.requirePermission(PERMISSIONS.trackUpload) }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const job = await prisma.uploadJob.findUnique({
      where: { id },
      include: { track: { select: { id: true, title: true, slug: true } } },
    });
    if (!job || (job.userId !== req.auth!.sub && !hasPermission(req.auth, PERMISSIONS.adminUploads))) {
      throw notFound('Upload job not found');
    }
    return {
      id: job.id,
      status: job.status,
      originalFilename: job.originalFilename,
      metadata: job.metadata,
      error: job.error,
      track: job.track,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  });
}

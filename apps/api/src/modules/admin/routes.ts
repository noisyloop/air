import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { redis } from '../../shared/redis.js';
import { meili } from '../../shared/meili.js';
import { parse } from '../../shared/validation.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';
import { PERMISSIONS } from '../../shared/rbac.js';
import { audit } from '../../shared/audit.js';
import { audioQueue, indexQueue, notifyQueue, rollupQueue } from '../../shared/queue.js';
import { pushToUser } from '../../shared/ws.js';
import { headObject, BUCKETS } from '../../shared/s3.js';

const idParam = z.object({ id: z.string() });

export default async function adminRoutes(app: FastifyInstance) {
  // ---- Users ----

  app.get('/users', { preHandler: app.requirePermission(PERMISSIONS.adminUsers) }, async (req) => {
    const q = parse(pageQuerySchema.extend({ search: z.string().max(100).optional() }), req.query);
    const where = q.search
      ? {
          OR: [
            { email: { contains: q.search, mode: 'insensitive' as const } },
            { displayName: { contains: q.search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, displayName: true, isActive: true, createdAt: true,
          roles: { select: { role: { select: { name: true } } } },
          _count: { select: { playlists: true, history: true, uploadJobs: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q.page, q.limit),
      }),
      prisma.user.count({ where }),
    ]);
    return toPage(
      items.map((u) => ({ ...u, roles: u.roles.map((r) => r.role.name) })),
      total,
      q.page,
      q.limit,
    );
  });

  // Suspend/reactivate + role assignment
  app.patch('/users/:id', { preHandler: app.requirePermission(PERMISSIONS.adminUsers) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ isActive: z.boolean().optional(), roles: z.array(z.string()).max(10).optional() }),
      req.body,
    );
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('User not found');
    if (id === req.auth!.sub && body.isActive === false) throw badRequest('Cannot suspend yourself');

    if (body.isActive !== undefined) {
      await prisma.user.update({ where: { id }, data: { isActive: body.isActive } });
      if (!body.isActive) {
        await prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    }
    if (body.roles) {
      const roles = await prisma.role.findMany({ where: { name: { in: body.roles } } });
      await prisma.$transaction([
        prisma.userRole.deleteMany({ where: { userId: id } }),
        prisma.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) }),
      ]);
    }
    audit({
      actorId: req.auth!.sub,
      action: 'admin.user_update',
      targetType: 'User',
      targetId: id,
      metadata: body as Record<string, unknown>,
      ip: req.ip,
    });
    return { ok: true };
  });

  // ---- Artists ----

  app.post('/artists', { preHandler: app.requirePermission(PERMISSIONS.adminUsers) }, async (req, reply) => {
    const body = parse(
      z.object({
        name: z.string().min(1).max(120),
        bio: z.string().max(2000).optional(),
        ownerUserId: z.string().optional(),
        verified: z.boolean().default(false),
        genreSlugs: z.array(z.string()).max(5).default([]),
      }),
      req.body,
    );
    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const genres = await prisma.genre.findMany({ where: { slug: { in: body.genreSlugs } } });
    const artist = await prisma.artist.create({
      data: {
        name: body.name,
        slug: `${slug}-${Date.now().toString(36)}`.replace(/^-/, 'a-'),
        bio: body.bio,
        ownerUserId: body.ownerUserId,
        verified: body.verified,
        genres: { create: genres.map((g) => ({ genreId: g.id })) },
      },
    });
    void indexQueue.add('artist', { entity: 'artist', id: artist.id }).catch(() => undefined);
    audit({ actorId: req.auth!.sub, action: 'admin.artist_create', targetType: 'Artist', targetId: artist.id });
    return reply.status(201).send({ id: artist.id, slug: artist.slug });
  });

  app.patch('/artists/:id', { preHandler: app.requirePermission(PERMISSIONS.adminUsers) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        name: z.string().min(1).max(120).optional(),
        bio: z.string().max(2000).nullable().optional(),
        verified: z.boolean().optional(),
        ownerUserId: z.string().nullable().optional(),
      }),
      req.body,
    );
    await prisma.artist.update({ where: { id }, data: body }).catch(() => {
      throw notFound('Artist not found');
    });
    void indexQueue.add('artist', { entity: 'artist', id }).catch(() => undefined);
    audit({ actorId: req.auth!.sub, action: 'admin.artist_update', targetType: 'Artist', targetId: id });
    return { ok: true };
  });

  // ---- Upload moderation ----

  app.get('/uploads', { preHandler: app.requirePermission(PERMISSIONS.adminUploads) }, async (req) => {
    const q = parse(
      pageQuerySchema.extend({
        status: z
          .enum(['PENDING', 'UPLOADED', 'PROCESSING', 'AWAITING_APPROVAL', 'READY', 'FAILED', 'REJECTED'])
          .default('AWAITING_APPROVAL'),
      }),
      req.query,
    );
    const where = { status: q.status };
    const [items, total] = await Promise.all([
      prisma.uploadJob.findMany({
        where,
        include: {
          user: { select: { id: true, displayName: true, email: true } },
          artist: { select: { id: true, name: true } },
          track: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'asc' },
        ...skipTake(q.page, q.limit),
      }),
      prisma.uploadJob.count({ where }),
    ]);
    return toPage(items, total, q.page, q.limit);
  });

  // Approve: publish track + notify followers. Reject: mark + notify uploader.
  app.post('/uploads/:id/review', { preHandler: app.requirePermission(PERMISSIONS.adminUploads) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { approve, reason } = parse(
      z.object({ approve: z.boolean(), reason: z.string().max(500).optional() }),
      req.body,
    );
    const job = await prisma.uploadJob.findUnique({ where: { id }, include: { track: true } });
    if (!job) throw notFound('Upload job not found');
    if (job.status !== 'AWAITING_APPROVAL') throw badRequest(`Job is ${job.status}, not awaiting approval`);

    if (approve && job.trackId) {
      await prisma.$transaction([
        prisma.uploadJob.update({
          where: { id },
          data: { status: 'READY', reviewedById: req.auth!.sub, reviewedAt: new Date() },
        }),
        prisma.track.update({ where: { id: job.trackId }, data: { publishedAt: new Date() } }),
      ]);
      void indexQueue.add('track', { entity: 'track', id: job.trackId }).catch(() => undefined);
      void notifyQueue
        .add('new_release', { kind: 'new_release', payload: { trackId: job.trackId, artistId: job.artistId } })
        .catch(() => undefined);
    } else {
      await prisma.uploadJob.update({
        where: { id },
        data: {
          status: 'REJECTED',
          error: reason ?? 'Rejected by moderator',
          reviewedById: req.auth!.sub,
          reviewedAt: new Date(),
        },
      });
    }
    const n = await prisma.notification.create({
      data: {
        userId: job.userId,
        type: 'UPLOAD_STATUS',
        title: approve ? 'Your upload was approved 🎉' : 'Your upload was rejected',
        body: approve ? undefined : reason,
        data: { uploadJobId: id },
      },
    });
    void pushToUser(job.userId, { kind: 'notification', notification: n });
    audit({
      actorId: req.auth!.sub,
      action: approve ? 'upload.approve' : 'upload.reject',
      targetType: 'UploadJob',
      targetId: id,
      metadata: { reason },
      ip: req.ip,
    });
    return { ok: true };
  });

  // ---- Metadata moderation ----

  app.patch('/tracks/:id', { preHandler: app.requirePermission(PERMISSIONS.adminUploads) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        title: z.string().min(1).max(200).optional(),
        explicit: z.boolean().optional(),
        lyrics: z.string().max(20000).nullable().optional(),
        credits: z.array(z.object({ role: z.string().max(60), name: z.string().max(120) })).max(30).optional(),
      }),
      req.body,
    );
    await prisma.track
      .update({ where: { id }, data: { ...body, credits: body.credits as never } })
      .catch(() => {
        throw notFound('Track not found');
      });
    void indexQueue.add('track', { entity: 'track', id }).catch(() => undefined);
    audit({ actorId: req.auth!.sub, action: 'admin.track_update', targetType: 'Track', targetId: id });
    return { ok: true };
  });

  app.delete('/tracks/:id', { preHandler: app.requirePermission(PERMISSIONS.adminSystem) }, async (req) => {
    const { id } = parse(idParam, req.params);
    await prisma.track.delete({ where: { id } }).catch(() => {
      throw notFound('Track not found');
    });
    void indexQueue.add('track', { entity: 'track', id, remove: true }).catch(() => undefined);
    audit({ actorId: req.auth!.sub, action: 'admin.track_delete', targetType: 'Track', targetId: id, ip: req.ip });
    return { ok: true };
  });

  // ---- System health, storage & operations ----

  app.get('/health', { preHandler: app.requirePermission(PERMISSIONS.adminSystem) }, async () => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(
        () => (checks.postgres = { ok: true }),
        (e: Error) => (checks.postgres = { ok: false, detail: e.message }),
      ),
      redis.ping().then(
        () => (checks.redis = { ok: true }),
        (e: Error) => (checks.redis = { ok: false, detail: e.message }),
      ),
      meili.health().then(
        () => (checks.meilisearch = { ok: true }),
        (e: Error) => (checks.meilisearch = { ok: false, detail: e.message }),
      ),
      headObject(BUCKETS.audio, '__healthcheck__').then(
        () => (checks.storage = { ok: true }),
        (e: { name?: string; message: string }) =>
          // A 404 on the probe object still proves the bucket is reachable.
          (checks.storage = { ok: e.name === 'NotFound', detail: e.name === 'NotFound' ? undefined : e.message }),
      ),
    ]);
    const queues = Object.fromEntries(
      await Promise.all(
        [audioQueue, indexQueue, notifyQueue, rollupQueue].map(
          async (q) => [q.name, await q.getJobCounts('waiting', 'active', 'failed', 'completed')] as const,
        ),
      ),
    );
    return { checks, queues, uptime: process.uptime(), memory: process.memoryUsage.rss() };
  });

  app.get('/storage', { preHandler: app.requirePermission(PERMISSIONS.adminSystem) }, async () => {
    const [variants, originals, jobs] = await Promise.all([
      prisma.audioVariant.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      prisma.trackFile.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      prisma.uploadJob.aggregate({ _sum: { sizeBytes: true }, _count: true }),
    ]);
    return {
      audioVariants: { count: variants._count, bytes: Number(variants._sum.sizeBytes ?? 0) },
      originals: { count: originals._count, bytes: Number(originals._sum.sizeBytes ?? 0) },
      uploads: { count: jobs._count, bytes: Number(jobs._sum.sizeBytes ?? 0) },
    };
  });

  // ---- Audit log ----

  app.get('/audit-logs', { preHandler: app.requirePermission(PERMISSIONS.adminAudit) }, async (req) => {
    const q = parse(
      pageQuerySchema.extend({ action: z.string().max(60).optional(), actorId: z.string().optional() }),
      req.query,
    );
    const where = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, displayName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q.page, q.limit),
      }),
      prisma.auditLog.count({ where }),
    ]);
    return toPage(items, total, q.page, q.limit);
  });

  // ---- Announcements & maintenance ----

  app.post('/announcements', { preHandler: app.requirePermission(PERMISSIONS.adminSystem) }, async (req, reply) => {
    const { title, body } = parse(
      z.object({ title: z.string().min(1).max(120), body: z.string().max(2000).optional() }),
      req.body,
    );
    await notifyQueue.add('system', { kind: 'system', payload: { title, body } });
    audit({ actorId: req.auth!.sub, action: 'admin.announce', metadata: { title }, ip: req.ip });
    return reply.status(202).send({ queued: true });
  });

  app.post('/reindex', { preHandler: app.requirePermission(PERMISSIONS.adminSystem) }, async (req, reply) => {
    await indexQueue.add('all', { entity: 'all' });
    audit({ actorId: req.auth!.sub, action: 'admin.reindex', ip: req.ip });
    return reply.status(202).send({ queued: true });
  });

  app.post('/rollup', { preHandler: app.requirePermission(PERMISSIONS.adminSystem) }, async (req, reply) => {
    const { day } = parse(z.object({ day: z.string().date().optional() }), req.body ?? {});
    await rollupQueue.add('rollup', { day });
    return reply.status(202).send({ queued: true });
  });
}

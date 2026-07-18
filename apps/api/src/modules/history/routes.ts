import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';
import { serializeTrack, trackInclude } from '../../shared/serialize.js';

const recordSchema = z.object({
  trackId: z.string(),
  msPlayed: z.number().int().min(0).max(3_600_000),
  completed: z.boolean().default(false),
  source: z
    .enum(['ALBUM', 'PLAYLIST', 'SEARCH', 'RADIO', 'LIBRARY', 'QUEUE', 'RECOMMENDATION', 'OTHER'])
    .default('OTHER'),
  contextId: z.string().optional(),
});

const progressSchema = z.object({
  trackId: z.string().nullable(),
  positionMs: z.number().int().min(0),
  queue: z
    .object({
      trackIds: z.array(z.string()).max(500),
      index: z.number().int().min(0),
      context: z.string().nullable().optional(),
    })
    .optional(),
  sessionId: z.string().optional(),
  deltaMs: z.number().int().min(0).max(120_000).optional(),
});

export default async function historyRoutes(app: FastifyInstance) {
  // POST /history — record a finished/abandoned play
  app.post('/', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parse(recordSchema, req.body);
    const track = await prisma.track.findUnique({ where: { id: body.trackId }, select: { id: true, artistId: true } });
    if (!track) return reply.status(204).send(); // deleted mid-play — drop silently
    await prisma.$transaction([
      prisma.history.create({ data: { userId: req.auth!.sub, ...body } }),
      // Only meaningful plays bump the public counter (anti-spam: >=30s or completed).
      ...(body.completed || body.msPlayed >= 30_000
        ? [prisma.track.update({ where: { id: track.id }, data: { playCount: { increment: 1 } } })]
        : []),
    ]);
    return reply.status(201).send({ ok: true });
  });

  // GET /history — recently played (deduplicated by track, newest first)
  app.get('/', { preHandler: app.authenticate }, async (req) => {
    const q = parse(pageQuerySchema, req.query);
    const rows = await prisma.history.findMany({
      where: { userId: req.auth!.sub },
      orderBy: { playedAt: 'desc' },
      include: { track: { include: trackInclude } },
      take: 200,
    });
    const seen = new Set<string>();
    const unique = rows.filter((r) => (seen.has(r.trackId) ? false : (seen.add(r.trackId), true)));
    const page = unique.slice((q.page - 1) * q.limit, q.page * q.limit);
    return toPage(
      page.map((r) => ({ playedAt: r.playedAt, source: r.source, ...serializeTrack(r.track) })),
      unique.length,
      q.page,
      q.limit,
    );
  });

  // POST /history/progress — heartbeat: playback position + queue for resume
  app.post('/progress', { preHandler: app.authenticate }, async (req) => {
    const body = parse(progressSchema, req.body);
    await prisma.playbackState.upsert({
      where: { userId: req.auth!.sub },
      create: {
        userId: req.auth!.sub,
        trackId: body.trackId,
        positionMs: body.positionMs,
        queue: body.queue as never,
      },
      update: { trackId: body.trackId, positionMs: body.positionMs, queue: body.queue as never },
    });
    if (body.sessionId && body.deltaMs) {
      await prisma.listeningSession
        .updateMany({
          where: { id: body.sessionId, userId: req.auth!.sub },
          data: { lastSeenAt: new Date(), msListened: { increment: body.deltaMs } },
        })
        .catch(() => undefined);
    }
    return { ok: true };
  });

  // GET /history/resume — restore playback after reconnect
  app.get('/resume', { preHandler: app.authenticate }, async (req) => {
    const state = await prisma.playbackState.findUnique({ where: { userId: req.auth!.sub } });
    if (!state?.trackId) return { track: null };
    const track = await prisma.track.findUnique({ where: { id: state.trackId }, include: trackInclude });
    return {
      track: track ? serializeTrack(track) : null,
      positionMs: state.positionMs,
      queue: state.queue,
      updatedAt: state.updatedAt,
    };
  });

  // POST /history/sessions — open a listening session (device analytics)
  app.post('/sessions', { preHandler: app.authenticate }, async (req, reply) => {
    const { deviceName } = parse(z.object({ deviceName: z.string().max(80).optional() }), req.body ?? {});
    const session = await prisma.listeningSession.create({
      data: {
        userId: req.auth!.sub,
        deviceName,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 255),
      },
    });
    return reply.status(201).send({ sessionId: session.id });
  });

  app.post('/sessions/:id/end', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await prisma.listeningSession.updateMany({
      where: { id, userId: req.auth!.sub, endedAt: null },
      data: { endedAt: new Date() },
    });
    return { ok: true };
  });
}

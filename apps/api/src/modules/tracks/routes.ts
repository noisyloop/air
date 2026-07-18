import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { notFound } from '../../shared/errors.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';
import { serializeTrack, trackInclude } from '../../shared/serialize.js';
import { signStreamToken } from '../../shared/tokens.js';
import { PERMISSIONS } from '../../shared/rbac.js';
import { presignGet, BUCKETS } from '../../shared/s3.js';

export default async function trackRoutes(app: FastifyInstance) {
  // GET /tracks — catalog browse
  app.get('/tracks', async (req) => {
    const q = parse(
      pageQuerySchema.extend({
        genre: z.string().optional(),
        artistId: z.string().optional(),
        sort: z.enum(['popular', 'newest']).default('popular'),
      }),
      req.query,
    );
    const where = {
      ...(q.genre ? { genres: { some: { genre: { slug: q.genre } } } } : {}),
      ...(q.artistId ? { artistId: q.artistId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.track.findMany({
        where,
        include: trackInclude,
        orderBy: q.sort === 'newest' ? { publishedAt: 'desc' } : { popularity: 'desc' },
        ...skipTake(q.page, q.limit),
      }),
      prisma.track.count({ where }),
    ]);
    return toPage(items.map(serializeTrack), total, q.page, q.limit);
  });

  // GET /tracks/:id — detail incl. available qualities + waveform link
  app.get('/tracks/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const track = await prisma.track.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: {
        ...trackInclude,
        variants: { select: { format: true, bitrateKbps: true, sizeBytes: true } },
        _count: { select: { favorites: true } },
      },
    });
    if (!track) throw notFound('Track not found');
    const liked = req.auth
      ? !!(await prisma.favorite.findFirst({ where: { userId: req.auth.sub, trackId: track.id } }))
      : false;
    const waveformUrl = track.waveformKey ? await presignGet(BUCKETS.audio, track.waveformKey) : null;
    return {
      ...serializeTrack({ ...track, liked }),
      credits: track.credits ?? [],
      lyrics: track.lyrics,
      loudnessLufs: track.loudnessLufs,
      isrc: track.isrc,
      favoriteCount: track._count.favorites,
      qualities: track.variants.map((v) => ({ format: v.format, bitrateKbps: v.bitrateKbps })),
      waveformUrl,
    };
  });

  // POST /tracks/:id/stream-token — short-lived token authorizing GET /stream/:id
  app.post(
    '/tracks/:id/stream-token',
    { preHandler: app.requirePermission(PERMISSIONS.streamAudio) },
    async (req) => {
      const { id } = parse(z.object({ id: z.string() }), req.params);
      const track = await prisma.track.findUnique({ where: { id }, select: { id: true } });
      if (!track) throw notFound('Track not found');
      return { token: signStreamToken(req.auth!.sub, id), expiresIn: 900 };
    },
  );

  // GET /genres — genre browse with counts
  app.get('/genres', async () => {
    const genres = await prisma.genre.findMany({
      include: { _count: { select: { tracks: true, artists: true, albums: true } } },
      orderBy: { name: 'asc' },
    });
    return {
      items: genres.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        trackCount: g._count.tracks,
        artistCount: g._count.artists,
        albumCount: g._count.albums,
      })),
    };
  });
}

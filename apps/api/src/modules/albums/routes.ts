import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { notFound } from '../../shared/errors.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';
import { serializeAlbum, serializeTrack, trackInclude } from '../../shared/serialize.js';
import { publicArtUrl } from '../../shared/s3.js';

const albumInclude = {
  artist: { select: { id: true, name: true, slug: true } },
  art: true,
  genres: { select: { genre: true } },
  _count: { select: { tracks: true, favorites: true } },
} as const;

export default async function albumRoutes(app: FastifyInstance) {
  // GET /albums — browse: newest / popular / by genre / by type
  app.get('/', async (req) => {
    const q = parse(
      pageQuerySchema.extend({
        genre: z.string().optional(),
        type: z.enum(['ALBUM', 'SINGLE', 'EP', 'COMPILATION']).optional(),
        sort: z.enum(['newest', 'popular']).default('newest'),
      }),
      req.query,
    );
    const where = {
      ...(q.genre ? { genres: { some: { genre: { slug: q.genre } } } } : {}),
      ...(q.type ? { type: q.type } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.album.findMany({
        where,
        include: albumInclude,
        orderBy: q.sort === 'popular' ? { popularity: 'desc' } : { releaseDate: 'desc' },
        ...skipTake(q.page, q.limit),
      }),
      prisma.album.count({ where }),
    ]);
    return toPage(items.map(serializeAlbum), total, q.page, q.limit);
  });

  // GET /albums/:id — album page: art, tracklist, credits, duration, popularity
  app.get('/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const album = await prisma.album.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: albumInclude,
    });
    if (!album) throw notFound('Album not found');

    const tracks = await prisma.track.findMany({
      where: { albumId: album.id },
      include: { ...trackInclude, _count: { select: { favorites: true } } },
      orderBy: [{ discNumber: 'asc' }, { trackNumber: 'asc' }],
    });
    const likedIds = req.auth
      ? new Set(
          (
            await prisma.favorite.findMany({
              where: { userId: req.auth.sub, trackId: { in: tracks.map((t) => t.id) } },
              select: { trackId: true },
            })
          ).map((f) => f.trackId),
        )
      : new Set<string | null>();
    const isLiked = req.auth
      ? !!(await prisma.favorite.findFirst({ where: { userId: req.auth.sub, albumId: album.id } }))
      : false;

    return {
      ...serializeAlbum(album),
      art: album.art.map((a) => ({ size: a.size, url: publicArtUrl(a.objectKey), width: a.width, height: a.height })),
      totalDurationMs: tracks.reduce((sum, t) => sum + t.durationMs, 0),
      favoriteCount: album._count.favorites,
      credits: tracks.flatMap((t) => (Array.isArray(t.credits) ? (t.credits as unknown[]) : [])),
      isLiked,
      tracks: tracks.map((t) => ({ ...serializeTrack(t), liked: likedIds.has(t.id) })),
    };
  });
}

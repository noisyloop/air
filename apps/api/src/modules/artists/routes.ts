import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { notFound } from '../../shared/errors.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';
import { serializeAlbum, serializeArtist, serializeTrack, trackInclude } from '../../shared/serialize.js';
import { PERMISSIONS } from '../../shared/rbac.js';

const idParam = z.object({ id: z.string() });

async function findArtist(idOrSlug: string) {
  const artist = await prisma.artist.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      genres: { select: { genre: true } },
      _count: { select: { followers: true } },
    },
  });
  if (!artist) throw notFound('Artist not found');
  return artist;
}

export default async function artistRoutes(app: FastifyInstance) {
  // GET /artists — browse, optionally by genre
  app.get('/', async (req) => {
    const q = parse(pageQuerySchema.extend({ genre: z.string().optional() }), req.query);
    const where = q.genre ? { genres: { some: { genre: { slug: q.genre } } } } : {};
    const [items, total] = await Promise.all([
      prisma.artist.findMany({
        where,
        include: { genres: { select: { genre: true } }, _count: { select: { followers: true } } },
        orderBy: { monthlyListeners: 'desc' },
        ...skipTake(q.page, q.limit),
      }),
      prisma.artist.count({ where }),
    ]);
    return toPage(items.map(serializeArtist), total, q.page, q.limit);
  });

  // GET /artists/:id — full artist page (bio, discography summary, popular tracks)
  app.get('/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(idParam, req.params);
    const artist = await findArtist(id);

    const [albums, singles, popularTracks, isFollowing, isLiked] = await Promise.all([
      prisma.album.findMany({
        where: { artistId: artist.id, type: { in: ['ALBUM', 'COMPILATION'] } },
        include: { artist: { select: { id: true, name: true, slug: true } }, art: { where: { size: 640 }, take: 1 }, genres: { select: { genre: true } }, _count: { select: { tracks: true } } },
        orderBy: { releaseDate: 'desc' },
      }),
      prisma.album.findMany({
        where: { artistId: artist.id, type: { in: ['SINGLE', 'EP'] } },
        include: { artist: { select: { id: true, name: true, slug: true } }, art: { where: { size: 640 }, take: 1 }, genres: { select: { genre: true } }, _count: { select: { tracks: true } } },
        orderBy: { releaseDate: 'desc' },
      }),
      prisma.track.findMany({
        where: { artistId: artist.id },
        include: trackInclude,
        orderBy: [{ popularity: 'desc' }, { playCount: 'desc' }],
        take: 10,
      }),
      req.auth
        ? prisma.follow.findFirst({ where: { followerId: req.auth.sub, artistId: artist.id } })
        : null,
      req.auth
        ? prisma.favorite.findFirst({ where: { userId: req.auth.sub, artistId: artist.id } })
        : null,
    ]);

    return {
      ...serializeArtist(artist),
      albums: albums.map(serializeAlbum),
      singles: singles.map(serializeAlbum),
      popularTracks: popularTracks.map(serializeTrack),
      isFollowing: !!isFollowing,
      isLiked: !!isLiked,
    };
  });

  // GET /artists/:id/related — shared-genre + shared-listener similarity
  app.get('/:id/related', async (req) => {
    const { id } = parse(idParam, req.params);
    const artist = await findArtist(id);
    const genreIds = artist.genres.map((g) => g.genre.id);
    const related = await prisma.artist.findMany({
      where: { id: { not: artist.id }, genres: { some: { genreId: { in: genreIds } } } },
      include: { genres: { select: { genre: true } }, _count: { select: { followers: true } } },
      orderBy: { monthlyListeners: 'desc' },
      take: 12,
    });
    return { items: related.map(serializeArtist) };
  });

  app.get('/:id/followers', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(pageQuerySchema, req.query);
    const artist = await findArtist(id);
    const [items, total] = await Promise.all([
      prisma.follow.findMany({
        where: { artistId: artist.id },
        include: { follower: { select: { id: true, displayName: true, avatarKey: true } } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q.page, q.limit),
      }),
      prisma.follow.count({ where: { artistId: artist.id } }),
    ]);
    return toPage(items.map((f) => f.follower), total, q.page, q.limit);
  });

  // POST /artists/:id/follow — toggle
  app.post('/:id/follow', { preHandler: app.requirePermission(PERMISSIONS.socialWrite) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const artist = await findArtist(id);
    const existing = await prisma.follow.findFirst({ where: { followerId: req.auth!.sub, artistId: artist.id } });
    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
      return { following: false };
    }
    await prisma.follow.create({ data: { followerId: req.auth!.sub, artistId: artist.id } });
    return { following: true };
  });
}

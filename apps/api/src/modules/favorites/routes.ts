import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { notFound } from '../../shared/errors.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';
import {
  serializeAlbum,
  serializeArtist,
  serializePlaylist,
  serializeTrack,
  trackInclude,
} from '../../shared/serialize.js';
import { PERMISSIONS } from '../../shared/rbac.js';

const toggleSchema = z.object({
  type: z.enum(['TRACK', 'ALBUM', 'ARTIST', 'PLAYLIST']),
  id: z.string(),
});

const FK: Record<string, 'trackId' | 'albumId' | 'artistId' | 'playlistId'> = {
  TRACK: 'trackId',
  ALBUM: 'albumId',
  ARTIST: 'artistId',
  PLAYLIST: 'playlistId',
};

export default async function favoriteRoutes(app: FastifyInstance) {
  // POST /favorites — toggle a like on any target type
  app.post('/', { preHandler: app.requirePermission(PERMISSIONS.socialWrite) }, async (req) => {
    const { type, id } = parse(toggleSchema, req.body);
    const fk = FK[type]!;

    const target =
      type === 'TRACK'
        ? await prisma.track.findUnique({ where: { id }, select: { id: true } })
        : type === 'ALBUM'
          ? await prisma.album.findUnique({ where: { id }, select: { id: true } })
          : type === 'ARTIST'
            ? await prisma.artist.findUnique({ where: { id }, select: { id: true } })
            : await prisma.playlist.findUnique({ where: { id, isPublic: true }, select: { id: true } });
    if (!target) throw notFound(`${type.toLowerCase()} not found`);

    const existing = await prisma.favorite.findFirst({ where: { userId: req.auth!.sub, [fk]: id } });
    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return { liked: false };
    }
    await prisma.favorite.create({ data: { userId: req.auth!.sub, type, [fk]: id } });
    return { liked: true };
  });

  // GET /favorites?type=TRACK — the caller's library, paginated, newest first
  app.get('/', { preHandler: app.authenticate }, async (req) => {
    const q = parse(pageQuerySchema.extend({ type: z.enum(['TRACK', 'ALBUM', 'ARTIST', 'PLAYLIST']) }), req.query);
    const where = { userId: req.auth!.sub, type: q.type };
    const [rows, total] = await Promise.all([
      prisma.favorite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          track: { include: trackInclude },
          album: {
            include: {
              artist: { select: { id: true, name: true, slug: true } },
              art: { where: { size: 640 }, take: 1 },
              genres: { select: { genre: true } },
              _count: { select: { tracks: true } },
            },
          },
          artist: { include: { genres: { select: { genre: true } }, _count: { select: { followers: true } } } },
          playlist: { include: { owner: { select: { id: true, displayName: true } }, _count: { select: { tracks: true } } } },
        },
        ...skipTake(q.page, q.limit),
      }),
      prisma.favorite.count({ where }),
    ]);
    const items = rows
      .map((f) => {
        if (f.track) return { likedAt: f.createdAt, ...serializeTrack({ ...f.track, liked: true }) };
        if (f.album) return { likedAt: f.createdAt, ...serializeAlbum(f.album) };
        if (f.artist) return { likedAt: f.createdAt, ...serializeArtist(f.artist) };
        if (f.playlist) return { likedAt: f.createdAt, ...serializePlaylist(f.playlist) };
        return null;
      })
      .filter(Boolean);
    return toPage(items, total, q.page, q.limit);
  });
}

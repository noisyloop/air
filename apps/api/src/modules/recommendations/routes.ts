import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { serializeAlbum, serializeTrack, trackInclude } from '../../shared/serialize.js';
import { recommendTracks, getUserSignals } from './service.js';

const albumInclude = {
  artist: { select: { id: true, name: true, slug: true } },
  art: { where: { size: 640 }, take: 1 },
  genres: { select: { genre: true } },
  _count: { select: { tracks: true } },
} as const;

async function hydrateTracks(ids: string[]) {
  const rows = await prisma.track.findMany({ where: { id: { in: ids } }, include: trackInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((t) => !!t).map(serializeTrack);
}

export default async function recommendationRoutes(app: FastifyInstance) {
  // GET /recommendations — ranked "Made for you" tracks
  app.get('/', { preHandler: app.authenticate }, async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(30) }), req.query);
    const scored = await recommendTracks(req.auth!.sub, limit);
    return { items: await hydrateTracks(scored.map((s) => s.trackId)) };
  });

  // GET /recommendations/home — sectioned home feed
  app.get('/home', { preHandler: app.optionalAuth }, async (req) => {
    const [newReleases, popularTracks] = await Promise.all([
      prisma.album.findMany({ include: albumInclude, orderBy: { releaseDate: 'desc' }, take: 12 }),
      prisma.track.findMany({ include: trackInclude, orderBy: { popularity: 'desc' }, take: 12 }),
    ]);

    const sections: Array<{ key: string; title: string; kind: 'track' | 'album'; items: unknown[] }> = [
      { key: 'new-releases', title: 'New releases', kind: 'album', items: newReleases.map(serializeAlbum) },
      { key: 'popular', title: 'Popular right now', kind: 'track', items: popularTracks.map(serializeTrack) },
    ];

    if (req.auth) {
      const [scored, signals] = await Promise.all([recommendTracks(req.auth.sub, 12), getUserSignals(req.auth.sub)]);
      if (scored.length > 0) {
        sections.unshift({
          key: 'made-for-you',
          title: 'Made for you',
          kind: 'track',
          items: await hydrateTracks(scored.map((s) => s.trackId)),
        });
      }
      // "Because you listened to <top artist>"
      const topArtistId = [...signals.artistCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topArtistId) {
        const artist = await prisma.artist.findUnique({ where: { id: topArtistId }, select: { name: true } });
        const tracks = await prisma.track.findMany({
          where: { artistId: topArtistId, id: { notIn: signals.recentTrackIds.slice(0, 100) } },
          include: trackInclude,
          orderBy: { popularity: 'desc' },
          take: 12,
        });
        if (artist && tracks.length > 0) {
          sections.push({
            key: 'because-artist',
            title: `Because you listened to ${artist.name}`,
            kind: 'track',
            items: tracks.map(serializeTrack),
          });
        }
      }
    }
    return { sections };
  });

  // GET /recommendations/radio/:trackId — autofill a queue from a seed track
  app.get('/radio/:trackId', { preHandler: app.authenticate }, async (req) => {
    const { trackId } = parse(z.object({ trackId: z.string() }), req.params);
    const seed = await prisma.track.findUnique({
      where: { id: trackId },
      select: { artistId: true, genres: { select: { genreId: true } } },
    });
    if (!seed) return { items: [] };
    const genreIds = seed.genres.map((g) => g.genreId);
    const tracks = await prisma.track.findMany({
      where: {
        id: { not: trackId },
        OR: [{ artistId: seed.artistId }, ...(genreIds.length ? [{ genres: { some: { genreId: { in: genreIds } } } }] : [])],
      },
      include: trackInclude,
      orderBy: { popularity: 'desc' },
      take: 25,
    });
    // Shuffle deterministically enough for radio feel.
    const items = tracks.sort(() => Math.random() - 0.5).slice(0, 20).map(serializeTrack);
    return { items };
  });
}

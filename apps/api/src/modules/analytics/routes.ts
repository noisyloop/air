import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { serializeArtist, serializeTrack, trackInclude } from '../../shared/serialize.js';
import { PERMISSIONS } from '../../shared/rbac.js';

const rangeSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
const since = (days: number) => new Date(Date.now() - days * 86_400_000);

export default async function analyticsRoutes(app: FastifyInstance) {
  // GET /analytics/top-tracks — public chart
  app.get('/top-tracks', async (req) => {
    const { days } = parse(rangeSchema, req.query);
    const top = await prisma.history.groupBy({
      by: ['trackId'],
      where: { playedAt: { gte: since(days) } },
      _count: { trackId: true },
      orderBy: { _count: { trackId: 'desc' } },
      take: 20,
    });
    const tracks = await prisma.track.findMany({ where: { id: { in: top.map((t) => t.trackId) } }, include: trackInclude });
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return {
      items: top
        .filter((t) => byId.has(t.trackId))
        .map((t, i) => ({ rank: i + 1, plays: t._count.trackId, ...serializeTrack(byId.get(t.trackId)!) })),
    };
  });

  // GET /analytics/top-artists — public chart
  app.get('/top-artists', async (req) => {
    const { days } = parse(rangeSchema, req.query);
    const rows = await prisma.history.findMany({
      where: { playedAt: { gte: since(days) } },
      select: { track: { select: { artistId: true } } },
    });
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.track.artistId, (counts.get(r.track.artistId) ?? 0) + 1);
    const topIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const artists = await prisma.artist.findMany({
      where: { id: { in: topIds.map(([id]) => id) } },
      include: { genres: { select: { genre: true } }, _count: { select: { followers: true } } },
    });
    const byId = new Map(artists.map((a) => [a.id, a]));
    return {
      items: topIds
        .filter(([id]) => byId.has(id))
        .map(([id, plays], i) => ({ rank: i + 1, plays, ...serializeArtist(byId.get(id)!) })),
    };
  });

  // GET /analytics/overview — admin dashboard aggregates
  app.get('/overview', { preHandler: app.requirePermission(PERMISSIONS.adminAnalytics) }, async (req) => {
    const { days } = parse(rangeSchema, req.query);
    const from = since(days);

    const [totalUsers, totalTracks, totalArtists, playsWindow, listeners, sessions, uploads, searches, dailyStats] =
      await Promise.all([
        prisma.user.count(),
        prisma.track.count(),
        prisma.artist.count(),
        prisma.history.count({ where: { playedAt: { gte: from } } }),
        prisma.history
          .findMany({ where: { playedAt: { gte: from } }, select: { userId: true }, distinct: ['userId'] })
          .then((r) => r.length),
        prisma.listeningSession.aggregate({
          where: { startedAt: { gte: from } },
          _count: true,
          _avg: { msListened: true },
          _sum: { bytesServed: true, msListened: true },
        }),
        prisma.uploadJob.groupBy({ by: ['status'], _count: true, where: { createdAt: { gte: from } } }),
        prisma.searchQuery.count({ where: { createdAt: { gte: from } } }),
        prisma.dailyStat.findMany({
          where: { date: { gte: from }, trackId: null, artistId: null },
          orderBy: { date: 'asc' },
        }),
      ]);

    // Retention: of users active in the previous window, how many came back this window.
    const prevFrom = since(days * 2);
    const [prevActive, currActive] = await Promise.all([
      prisma.history.findMany({
        where: { playedAt: { gte: prevFrom, lt: from } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prisma.history.findMany({ where: { playedAt: { gte: from } }, select: { userId: true }, distinct: ['userId'] }),
    ]);
    const currSet = new Set(currActive.map((u) => u.userId));
    const returned = prevActive.filter((u) => currSet.has(u.userId)).length;

    return {
      totals: { users: totalUsers, tracks: totalTracks, artists: totalArtists },
      window: {
        days,
        plays: playsWindow,
        uniqueListeners: listeners,
        sessions: sessions._count,
        avgSessionMs: Math.round(sessions._avg.msListened ?? 0),
        totalListenedMs: Number(sessions._sum.msListened ?? 0),
        bandwidthBytes: Number(sessions._sum.bytesServed ?? 0),
        searches,
        retentionRate: prevActive.length ? returned / prevActive.length : null,
      },
      uploadsByStatus: Object.fromEntries(uploads.map((u) => [u.status, u._count])),
      daily: dailyStats.map((d) => ({
        date: d.date,
        plays: d.plays,
        listeners: d.uniqueUsers,
        msPlayed: Number(d.msPlayed),
        bandwidthBytes: Number(d.bytesServed),
        searches: d.searches,
        newUsers: d.newUsers,
        activeUsers: d.activeUsers,
      })),
    };
  });

  // GET /analytics/top-searches — admin: most searched terms
  app.get('/top-searches', { preHandler: app.requirePermission(PERMISSIONS.adminAnalytics) }, async (req) => {
    const { days } = parse(rangeSchema, req.query);
    const rows = await prisma.searchQuery.groupBy({
      by: ['query'],
      where: { createdAt: { gte: since(days) } },
      _count: { query: true },
      orderBy: { _count: { query: 'desc' } },
      take: 25,
    });
    return { items: rows.map((r) => ({ query: r.query, count: r._count.query })) };
  });
}

import { prisma } from '../../shared/prisma.js';
import { redis } from '../../shared/redis.js';
import type { RollupJobData } from '../../shared/queue.js';

const dayBounds = (day: Date) => {
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  return { from, to: new Date(from.getTime() + 86_400_000) };
};

/**
 * Daily analytics rollup + derived metrics:
 * - global & per-track/per-artist DailyStat rows
 * - track/album popularity (0-100 from 30-day play share)
 * - artist monthly listeners
 * - trending-search decay
 */
export async function processRollupJob(job: RollupJobData): Promise<void> {
  const day = job.day ? new Date(job.day) : new Date(Date.now() - 86_400_000);
  const { from, to } = dayBounds(day);

  const [plays, sessions, uploads, searches, newUsers] = await Promise.all([
    prisma.history.findMany({
      where: { playedAt: { gte: from, lt: to } },
      select: { userId: true, trackId: true, msPlayed: true, track: { select: { artistId: true } } },
    }),
    prisma.listeningSession.aggregate({
      where: { startedAt: { gte: from, lt: to } },
      _sum: { bytesServed: true },
    }),
    prisma.uploadJob.count({ where: { createdAt: { gte: from, lt: to } } }),
    prisma.searchQuery.count({ where: { createdAt: { gte: from, lt: to } } }),
    prisma.user.count({ where: { createdAt: { gte: from, lt: to } } }),
  ]);

  // Global row
  const uniqueUsers = new Set(plays.map((p) => p.userId)).size;
  const msPlayed = plays.reduce((s, p) => s + p.msPlayed, 0);
  await prisma.dailyStat.deleteMany({ where: { date: from } });
  await prisma.dailyStat.create({
    data: {
      date: from,
      plays: plays.length,
      uniqueUsers,
      msPlayed: BigInt(msPlayed),
      bytesServed: sessions._sum.bytesServed ?? BigInt(0),
      uploads,
      searches,
      newUsers,
      activeUsers: uniqueUsers,
    },
  });

  // Per-track and per-artist rows
  const byTrack = new Map<string, { plays: number; users: Set<string>; ms: number; artistId: string }>();
  for (const p of plays) {
    const t = byTrack.get(p.trackId) ?? { plays: 0, users: new Set<string>(), ms: 0, artistId: p.track.artistId };
    t.plays++;
    t.users.add(p.userId);
    t.ms += p.msPlayed;
    byTrack.set(p.trackId, t);
  }
  const byArtist = new Map<string, { plays: number; users: Set<string>; ms: number }>();
  for (const [, t] of byTrack) {
    const a = byArtist.get(t.artistId) ?? { plays: 0, users: new Set<string>(), ms: 0 };
    a.plays += t.plays;
    for (const u of t.users) a.users.add(u);
    a.ms += t.ms;
    byArtist.set(t.artistId, a);
  }
  await prisma.dailyStat.createMany({
    data: [
      ...[...byTrack.entries()].map(([trackId, t]) => ({
        date: from,
        trackId,
        plays: t.plays,
        uniqueUsers: t.users.size,
        msPlayed: BigInt(t.ms),
      })),
      ...[...byArtist.entries()].map(([artistId, a]) => ({
        date: from,
        artistId,
        plays: a.plays,
        uniqueUsers: a.users.size,
        msPlayed: BigInt(a.ms),
      })),
    ],
  });

  // ---- popularity: 30-day play share, log-scaled to 0-100 ----
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const trackPlays = await prisma.history.groupBy({
    by: ['trackId'],
    where: { playedAt: { gte: since30 } },
    _count: { trackId: true },
  });
  const maxPlays = Math.max(1, ...trackPlays.map((t) => t._count.trackId));
  for (const t of trackPlays) {
    const popularity = Math.round((Math.log1p(t._count.trackId) / Math.log1p(maxPlays)) * 100);
    await prisma.track.update({ where: { id: t.trackId }, data: { popularity } }).catch(() => undefined);
  }
  // Album popularity = max of its tracks'.
  await prisma.$executeRaw`
    UPDATE "Album" a SET "popularity" = COALESCE(
      (SELECT MAX(t."popularity") FROM "Track" t WHERE t."albumId" = a."id"), 0)`;

  // ---- artist monthly listeners ----
  const artistListeners = await prisma.$queryRaw<Array<{ artistId: string; listeners: bigint }>>`
    SELECT t."artistId" as "artistId", COUNT(DISTINCT h."userId") as listeners
    FROM "History" h JOIN "Track" t ON t."id" = h."trackId"
    WHERE h."playedAt" >= ${since30}
    GROUP BY t."artistId"`;
  await prisma.artist.updateMany({ data: { monthlyListeners: 0 } });
  for (const a of artistListeners) {
    await prisma.artist.update({ where: { id: a.artistId }, data: { monthlyListeners: Number(a.listeners) } });
  }

  // ---- trending-search decay: halve scores daily, drop the noise floor ----
  const TRENDING_KEY = 'air:search:trending';
  const entries = await redis.zrange(TRENDING_KEY, 0, -1, 'WITHSCORES').catch(() => [] as string[]);
  const multi = redis.multi();
  for (let i = 0; i < entries.length; i += 2) {
    const member = entries[i]!;
    const score = Number(entries[i + 1]) / 2;
    if (score < 0.5) multi.zrem(TRENDING_KEY, member);
    else multi.zadd(TRENDING_KEY, score, member);
  }
  await multi.exec().catch(() => undefined);

  // Close listening sessions idle for >1h.
  await prisma.listeningSession.updateMany({
    where: { endedAt: null, lastSeenAt: { lt: new Date(Date.now() - 3_600_000) } },
    data: { endedAt: new Date() },
  });
}

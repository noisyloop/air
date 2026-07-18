/**
 * Modular recommendation engine — no external AI services.
 *
 * Each scorer is a pure function over pre-fetched signals; scores are combined
 * with a weighted sum. Add a scorer by implementing `Scorer` and registering it
 * in `SCORERS` with a weight.
 */
import { prisma } from '../../shared/prisma.js';
import { redis } from '../../shared/redis.js';

export interface UserSignals {
  userId: string;
  recentTrackIds: string[]; // most recent first
  playedTrackIds: Set<string>;
  genreCounts: Map<string, number>; // genreId -> plays
  artistCounts: Map<string, number>; // artistId -> plays
  likedTrackIds: Set<string>;
}

export interface Candidate {
  id: string;
  artistId: string;
  genreIds: string[];
  popularity: number;
  publishedAt: Date | null;
  coPlayCount: number; // co-occurrence votes from collaborative filtering
}

export type Scorer = (signals: UserSignals, candidate: Candidate) => number;

/** Users who played your tracks also played these — normalized co-play votes. */
const collaborativeScorer: Scorer = (_signals, c) => Math.min(1, c.coPlayCount / 10);

/** Jaccard-ish overlap between the user's top genres and the candidate's genres. */
const genreScorer: Scorer = (signals, c) => {
  if (c.genreIds.length === 0 || signals.genreCounts.size === 0) return 0;
  const total = [...signals.genreCounts.values()].reduce((a, b) => a + b, 0) || 1;
  let score = 0;
  for (const g of c.genreIds) score += (signals.genreCounts.get(g) ?? 0) / total;
  return Math.min(1, score);
};

/** Familiar artists you've heard recently, but tracks you haven't played. */
const recencyScorer: Scorer = (signals, c) => {
  const plays = signals.artistCounts.get(c.artistId) ?? 0;
  if (plays === 0) return 0;
  return Math.min(1, plays / 20) * (signals.playedTrackIds.has(c.id) ? 0 : 1);
};

/** Global popularity prior, damped so it never dominates. */
const popularityScorer: Scorer = (_signals, c) => (c.popularity / 100) * 0.5;

/** Slight boost for fresh releases. */
const freshnessScorer: Scorer = (_signals, c) => {
  if (!c.publishedAt) return 0;
  const days = (Date.now() - c.publishedAt.getTime()) / 86_400_000;
  return days < 30 ? (30 - days) / 30 : 0;
};

const SCORERS: Array<{ name: string; weight: number; fn: Scorer }> = [
  { name: 'collaborative', weight: 0.35, fn: collaborativeScorer },
  { name: 'genre', weight: 0.25, fn: genreScorer },
  { name: 'recency', weight: 0.15, fn: recencyScorer },
  { name: 'popularity', weight: 0.15, fn: popularityScorer },
  { name: 'freshness', weight: 0.1, fn: freshnessScorer },
];

export function scoreCandidate(signals: UserSignals, candidate: Candidate): number {
  return SCORERS.reduce((sum, s) => sum + s.weight * s.fn(signals, candidate), 0);
}

export async function getUserSignals(userId: string): Promise<UserSignals> {
  const [history, likes] = await Promise.all([
    prisma.history.findMany({
      where: { userId },
      orderBy: { playedAt: 'desc' },
      take: 300,
      include: { track: { select: { artistId: true, genres: { select: { genreId: true } } } } },
    }),
    prisma.favorite.findMany({ where: { userId, type: 'TRACK' }, select: { trackId: true } }),
  ]);

  const genreCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();
  for (const h of history) {
    artistCounts.set(h.track.artistId, (artistCounts.get(h.track.artistId) ?? 0) + 1);
    for (const g of h.track.genres) genreCounts.set(g.genreId, (genreCounts.get(g.genreId) ?? 0) + 1);
  }
  return {
    userId,
    recentTrackIds: [...new Set(history.map((h) => h.trackId))],
    playedTrackIds: new Set(history.map((h) => h.trackId)),
    genreCounts,
    artistCounts,
    likedTrackIds: new Set(likes.map((l) => l.trackId!).filter(Boolean)),
  };
}

/** Item-to-item co-occurrence: counts of candidate tracks played by "neighbors". */
async function getCoPlayCounts(signals: UserSignals): Promise<Map<string, number>> {
  const seedTracks = signals.recentTrackIds.slice(0, 25);
  if (seedTracks.length === 0) return new Map();
  const neighborRows = await prisma.history.findMany({
    where: { trackId: { in: seedTracks }, userId: { not: signals.userId } },
    select: { userId: true },
    distinct: ['userId'],
    take: 50,
  });
  const neighborIds = neighborRows.map((r) => r.userId);
  if (neighborIds.length === 0) return new Map();
  const coPlays = await prisma.history.groupBy({
    by: ['trackId'],
    where: { userId: { in: neighborIds }, trackId: { notIn: seedTracks } },
    _count: { trackId: true },
    orderBy: { _count: { trackId: 'desc' } },
    take: 200,
  });
  return new Map(coPlays.map((c) => [c.trackId, c._count.trackId]));
}

export interface ScoredTrack {
  trackId: string;
  score: number;
}

/** Main entry: ranked track recommendations for a user (cached 10 min). */
export async function recommendTracks(userId: string, limit = 30): Promise<ScoredTrack[]> {
  const cacheKey = `air:recs:${userId}:${limit}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as ScoredTrack[];

  const signals = await getUserSignals(userId);
  const coPlayCounts = await getCoPlayCounts(signals);

  // Candidate pool: co-played + top tracks from the user's genres + popular fallback.
  const topGenreIds = [...signals.genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);
  const candidates = await prisma.track.findMany({
    where: {
      OR: [
        { id: { in: [...coPlayCounts.keys()] } },
        ...(topGenreIds.length ? [{ genres: { some: { genreId: { in: topGenreIds } } } }] : []),
        { popularity: { gte: 60 } },
      ],
    },
    select: {
      id: true,
      artistId: true,
      popularity: true,
      publishedAt: true,
      genres: { select: { genreId: true } },
    },
    take: 500,
  });

  const scored = candidates
    .filter((c) => !signals.likedTrackIds.has(c.id)) // don't recommend what's already liked
    .map((c) => ({
      trackId: c.id,
      score: scoreCandidate(signals, {
        id: c.id,
        artistId: c.artistId,
        genreIds: c.genres.map((g) => g.genreId),
        popularity: c.popularity,
        publishedAt: c.publishedAt,
        coPlayCount: coPlayCounts.get(c.id) ?? 0,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  await redis.set(cacheKey, JSON.stringify(scored), 'EX', 600).catch(() => undefined);
  return scored;
}

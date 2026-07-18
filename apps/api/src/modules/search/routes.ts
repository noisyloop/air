import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { meili, INDEXES } from '../../shared/meili.js';
import { redis } from '../../shared/redis.js';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(['all', 'tracks', 'albums', 'artists', 'playlists', 'genres']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const TRENDING_KEY = 'air:search:trending';
const recentKey = (userId: string) => `air:search:recent:${userId}`;

async function searchIndex(index: string, q: string, limit: number, filter?: string) {
  try {
    const res = await meili.index(index).search(q, { limit, filter });
    return res.hits;
  } catch {
    return []; // search degraded — return empty rather than 500
  }
}

export default async function searchRoutes(app: FastifyInstance) {
  // GET /search?q=... — federated, typo-tolerant search
  app.get('/', { preHandler: app.optionalAuth }, async (req) => {
    const { q, type, limit } = parse(searchSchema, req.query);
    const wants = (t: string) => type === 'all' || type === t;

    const [tracks, albums, artists, playlists, genres] = await Promise.all([
      wants('tracks') ? searchIndex(INDEXES.tracks, q, limit) : [],
      wants('albums') ? searchIndex(INDEXES.albums, q, limit) : [],
      wants('artists') ? searchIndex(INDEXES.artists, q, limit) : [],
      wants('playlists') ? searchIndex(INDEXES.playlists, q, limit, 'isPublic = true') : [],
      wants('genres') ? searchIndex(INDEXES.genres, q, limit) : [],
    ]);

    const resultCount = tracks.length + albums.length + artists.length + playlists.length + genres.length;
    // Log for trending/analytics (fire-and-forget).
    void prisma.searchQuery
      .create({ data: { query: q.toLowerCase().slice(0, 100), userId: req.auth?.sub, resultCount } })
      .catch(() => undefined);
    void redis.zincrby(TRENDING_KEY, 1, q.toLowerCase().slice(0, 100)).catch(() => undefined);
    if (req.auth) {
      const key = recentKey(req.auth.sub);
      void redis
        .multi()
        .lrem(key, 0, q)
        .lpush(key, q)
        .ltrim(key, 0, 19)
        .expire(key, 60 * 86400)
        .exec()
        .catch(() => undefined);
    }

    return { query: q, tracks, albums, artists, playlists, genres };
  });

  // GET /search/suggest?q=... — fast autocomplete (prefix search, top hits only)
  app.get('/suggest', async (req) => {
    const { q } = parse(z.object({ q: z.string().min(1).max(100) }), req.query);
    const [tracks, artists, albums] = await Promise.all([
      searchIndex(INDEXES.tracks, q, 4),
      searchIndex(INDEXES.artists, q, 3),
      searchIndex(INDEXES.albums, q, 3),
    ]);
    return {
      suggestions: [
        ...artists.map((h) => ({ type: 'artist', id: h.id, label: h.name, sub: 'Artist', imageUrl: h.imageUrl })),
        ...tracks.map((h) => ({ type: 'track', id: h.id, label: h.title, sub: h.artistName, imageUrl: h.artUrl })),
        ...albums.map((h) => ({ type: 'album', id: h.id, label: h.title, sub: h.artistName, imageUrl: h.artUrl })),
      ],
    };
  });

  // GET /search/recent — the caller's recent queries
  app.get('/recent', { preHandler: app.authenticate }, async (req) => {
    const items = await redis.lrange(recentKey(req.auth!.sub), 0, 9).catch(() => []);
    return { items };
  });

  app.delete('/recent', { preHandler: app.authenticate }, async (req) => {
    await redis.del(recentKey(req.auth!.sub)).catch(() => undefined);
    return { ok: true };
  });

  // GET /search/trending — most-searched terms (decayed daily by the worker)
  app.get('/trending', async () => {
    const raw = await redis.zrevrange(TRENDING_KEY, 0, 9, 'WITHSCORES').catch(() => [] as string[]);
    const items = [];
    for (let i = 0; i < raw.length; i += 2) items.push({ query: raw[i], count: Number(raw[i + 1]) });
    return { items };
  });
}

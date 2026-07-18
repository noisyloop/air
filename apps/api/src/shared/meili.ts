import { MeiliSearch } from 'meilisearch';
import { config } from '../config.js';

export const meili = new MeiliSearch({
  host: config.MEILI_HOST,
  apiKey: config.MEILI_MASTER_KEY,
});

export const INDEXES = {
  tracks: 'tracks',
  albums: 'albums',
  artists: 'artists',
  playlists: 'playlists',
  genres: 'genres',
} as const;

/** Idempotent index configuration — safe to run at worker startup. */
export async function configureIndexes(): Promise<void> {
  await meili.createIndex(INDEXES.tracks, { primaryKey: 'id' }).catch(() => undefined);
  await meili.createIndex(INDEXES.albums, { primaryKey: 'id' }).catch(() => undefined);
  await meili.createIndex(INDEXES.artists, { primaryKey: 'id' }).catch(() => undefined);
  await meili.createIndex(INDEXES.playlists, { primaryKey: 'id' }).catch(() => undefined);
  await meili.createIndex(INDEXES.genres, { primaryKey: 'id' }).catch(() => undefined);

  await meili.index(INDEXES.tracks).updateSettings({
    searchableAttributes: ['title', 'artistName', 'albumTitle', 'genres'],
    filterableAttributes: ['artistId', 'albumId', 'genres', 'explicit'],
    sortableAttributes: ['popularity', 'publishedAt'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'popularity:desc'],
  });
  await meili.index(INDEXES.albums).updateSettings({
    searchableAttributes: ['title', 'artistName', 'genres'],
    filterableAttributes: ['artistId', 'type', 'genres'],
    sortableAttributes: ['popularity', 'releaseDate'],
  });
  await meili.index(INDEXES.artists).updateSettings({
    searchableAttributes: ['name', 'genres'],
    sortableAttributes: ['monthlyListeners'],
  });
  await meili.index(INDEXES.playlists).updateSettings({
    searchableAttributes: ['title', 'description', 'ownerName'],
    filterableAttributes: ['isPublic'],
  });
  await meili.index(INDEXES.genres).updateSettings({
    searchableAttributes: ['name'],
  });
}

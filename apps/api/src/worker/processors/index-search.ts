import { prisma } from '../../shared/prisma.js';
import { meili, INDEXES } from '../../shared/meili.js';
import { publicArtUrl } from '../../shared/s3.js';
import type { IndexJobData } from '../../shared/queue.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const trackDoc = (t: any) => ({
  id: t.id,
  title: t.title,
  slug: t.slug,
  artistId: t.artistId,
  artistName: t.artist.name,
  albumId: t.albumId,
  albumTitle: t.album.title,
  artUrl: publicArtUrl(t.album.art?.[0]?.objectKey),
  genres: t.genres.map((g: any) => g.genre.name),
  durationMs: t.durationMs,
  explicit: t.explicit,
  popularity: t.popularity,
  publishedAt: t.publishedAt ? new Date(t.publishedAt).getTime() : 0,
});

const trackQuery = {
  include: {
    artist: { select: { name: true } },
    album: { select: { title: true, art: { where: { size: 640 }, take: 1 } } },
    genres: { select: { genre: { select: { name: true } } } },
  },
} as const;

const albumDoc = (a: any) => ({
  id: a.id,
  title: a.title,
  slug: a.slug,
  type: a.type,
  artistId: a.artistId,
  artistName: a.artist.name,
  artUrl: publicArtUrl(a.art?.[0]?.objectKey),
  genres: a.genres.map((g: any) => g.genre.name),
  releaseDate: a.releaseDate ? new Date(a.releaseDate).getTime() : 0,
  popularity: a.popularity,
});

const albumQuery = {
  include: {
    artist: { select: { name: true } },
    art: { where: { size: 640 }, take: 1 },
    genres: { select: { genre: { select: { name: true } } } },
  },
} as const;

const artistDoc = (ar: any) => ({
  id: ar.id,
  name: ar.name,
  slug: ar.slug,
  imageUrl: publicArtUrl(ar.imageKey),
  genres: ar.genres.map((g: any) => g.genre.name),
  verified: ar.verified,
  monthlyListeners: ar.monthlyListeners,
});

const artistQuery = { include: { genres: { select: { genre: { select: { name: true } } } } } } as const;

const playlistDoc = (p: any) => ({
  id: p.id,
  title: p.title,
  description: p.description ?? '',
  ownerName: p.owner.displayName,
  coverUrl: publicArtUrl(p.coverKey),
  isPublic: p.isPublic,
  trackCount: p._count.tracks,
});

const playlistQuery = {
  include: { owner: { select: { displayName: true } }, _count: { select: { tracks: true } } },
} as const;

/** Sync one entity (or everything) into Meilisearch. */
export async function processIndexJob(data: IndexJobData): Promise<void> {
  const { entity, id, remove } = data;

  if (remove && id) {
    if (entity !== 'all') await meili.index(`${entity}s`).deleteDocument(id).catch(() => undefined);
    return;
  }

  if (entity === 'all') {
    const [tracks, albums, artists, playlists, genres] = await Promise.all([
      prisma.track.findMany({ where: { publishedAt: { not: null } }, ...trackQuery }),
      prisma.album.findMany(albumQuery),
      prisma.artist.findMany(artistQuery),
      prisma.playlist.findMany({ where: { isPublic: true }, ...playlistQuery }),
      prisma.genre.findMany(),
    ]);
    await Promise.all([
      meili.index(INDEXES.tracks).addDocuments(tracks.map(trackDoc)),
      meili.index(INDEXES.albums).addDocuments(albums.map(albumDoc)),
      meili.index(INDEXES.artists).addDocuments(artists.map(artistDoc)),
      meili.index(INDEXES.playlists).addDocuments(playlists.map(playlistDoc)),
      meili.index(INDEXES.genres).addDocuments(genres.map((g) => ({ id: g.id, name: g.name, slug: g.slug }))),
    ]);
    return;
  }

  if (!id) return;
  switch (entity) {
    case 'track': {
      const t = await prisma.track.findUnique({ where: { id }, ...trackQuery });
      if (t) await meili.index(INDEXES.tracks).addDocuments([trackDoc(t)]);
      break;
    }
    case 'album': {
      const a = await prisma.album.findUnique({ where: { id }, ...albumQuery });
      if (a) await meili.index(INDEXES.albums).addDocuments([albumDoc(a)]);
      break;
    }
    case 'artist': {
      const ar = await prisma.artist.findUnique({ where: { id }, ...artistQuery });
      if (ar) await meili.index(INDEXES.artists).addDocuments([artistDoc(ar)]);
      break;
    }
    case 'playlist': {
      const p = await prisma.playlist.findUnique({ where: { id }, ...playlistQuery });
      if (p && p.isPublic) await meili.index(INDEXES.playlists).addDocuments([playlistDoc(p)]);
      else await meili.index(INDEXES.playlists).deleteDocument(id).catch(() => undefined);
      break;
    }
    case 'genre': {
      const g = await prisma.genre.findUnique({ where: { id } });
      if (g) await meili.index(INDEXES.genres).addDocuments([{ id: g.id, name: g.name, slug: g.slug }]);
      break;
    }
  }
}

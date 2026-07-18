import { publicArtUrl } from './s3.js';

/** Common include fragments + JSON-safe serializers for catalog entities. */

export const trackInclude = {
  artist: { select: { id: true, name: true, slug: true } },
  album: {
    select: {
      id: true,
      title: true,
      slug: true,
      art: { where: { size: 640 }, select: { objectKey: true }, take: 1 },
    },
  },
  genres: { select: { genre: { select: { id: true, name: true, slug: true } } } },
} as const;

// Loosely typed on purpose: accepts prisma results with the includes above.
/* eslint-disable @typescript-eslint/no-explicit-any */

export function serializeTrack(t: any) {
  return {
    id: t.id,
    title: t.title,
    slug: t.slug,
    durationMs: t.durationMs,
    trackNumber: t.trackNumber,
    discNumber: t.discNumber,
    explicit: t.explicit,
    popularity: t.popularity,
    playCount: t.playCount != null ? Number(t.playCount) : undefined,
    publishedAt: t.publishedAt,
    artist: t.artist,
    album: t.album
      ? { id: t.album.id, title: t.album.title, slug: t.album.slug, artUrl: publicArtUrl(t.album.art?.[0]?.objectKey) }
      : undefined,
    genres: t.genres?.map((g: any) => g.genre) ?? [],
    liked: t.liked,
  };
}

export function serializeAlbum(a: any) {
  return {
    id: a.id,
    title: a.title,
    slug: a.slug,
    type: a.type,
    releaseDate: a.releaseDate,
    label: a.label,
    popularity: a.popularity,
    artist: a.artist,
    artUrl: publicArtUrl(a.art?.[0]?.objectKey),
    genres: a.genres?.map((g: any) => g.genre) ?? [],
    trackCount: a._count?.tracks,
  };
}

export function serializeArtist(ar: any) {
  return {
    id: ar.id,
    name: ar.name,
    slug: ar.slug,
    bio: ar.bio,
    verified: ar.verified,
    monthlyListeners: ar.monthlyListeners,
    imageUrl: publicArtUrl(ar.imageKey),
    genres: ar.genres?.map((g: any) => g.genre) ?? [],
    followerCount: ar._count?.followers,
  };
}

export function serializePlaylist(p: any) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    coverUrl: publicArtUrl(p.coverKey),
    isPublic: p.isPublic,
    isCollaborative: p.isCollaborative,
    shareId: p.shareId,
    owner: p.owner ? { id: p.owner.id, displayName: p.owner.displayName } : undefined,
    trackCount: p._count?.tracks,
    updatedAt: p.updatedAt,
  };
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  avatarUrl?: string | null;
  bio?: string | null;
  artistProfile?: { id: string; name: string; slug: string } | null;
}

export interface Track {
  id: string;
  title: string;
  slug: string;
  durationMs: number;
  trackNumber: number;
  explicit: boolean;
  popularity: number;
  playCount?: number;
  artist: { id: string; name: string; slug: string };
  album?: { id: string; title: string; slug: string; artUrl: string | null };
  genres: { id: string; name: string; slug: string }[];
  liked?: boolean;
  waveformUrl?: string | null;
  qualities?: { format: string; bitrateKbps: number }[];
}

export interface Album {
  id: string;
  title: string;
  slug: string;
  type: string;
  releaseDate: string | null;
  popularity: number;
  artist: { id: string; name: string; slug: string };
  artUrl: string | null;
  genres: { id: string; name: string; slug: string }[];
  trackCount?: number;
  tracks?: Track[];
  totalDurationMs?: number;
  isLiked?: boolean;
  credits?: { role: string; name: string }[];
}

export interface Artist {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  verified: boolean;
  monthlyListeners: number;
  imageUrl: string | null;
  genres: { id: string; name: string; slug: string }[];
  followerCount?: number;
  albums?: Album[];
  singles?: Album[];
  popularTracks?: Track[];
  isFollowing?: boolean;
  isLiked?: boolean;
}

export interface Playlist {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  isPublic: boolean;
  isCollaborative: boolean;
  shareId: string;
  owner?: { id: string; displayName: string };
  trackCount?: number;
  tracks?: (Track & { position: number; addedAt: string })[];
  totalDurationMs?: number;
  canEdit?: boolean;
  canAddTracks?: boolean;
  pinned?: boolean;
  updatedAt?: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface HomeSection {
  key: string;
  title: string;
  kind: 'track' | 'album';
  items: (Track | Album)[];
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface UploadJob {
  id: string;
  status: string;
  originalFilename: string;
  metadata: { title?: string; albumTitle?: string };
  error: string | null;
  track?: { id: string; title: string } | null;
  artist?: { id: string; name: string };
  createdAt: string;
  user?: { id: string; displayName: string; email: string };
}

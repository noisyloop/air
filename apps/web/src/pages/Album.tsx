import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import type { Album } from '../lib/types';
import { formatLongDuration, formatYear } from '../lib/format';
import { usePlayer } from '../stores/player';
import { useUi } from '../stores/ui';
import { Artwork } from '../components/Artwork';
import { TrackList } from '../components/TrackList';
import { HeaderSkeleton, TrackListSkeleton } from '../components/Skeletons';
import { HeartIcon, PlayIcon, ShuffleIcon } from '../components/Icons';

export default function AlbumPage() {
  const { id } = useParams();
  const { data: album, loading, setData } = useFetch<Album>(id ? `/albums/${id}` : null);
  const playTracks = usePlayer((s) => s.playTracks);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const shuffle = usePlayer((s) => s.shuffle);
  const showToast = useUi((s) => s.showToast);

  if (loading || !album) {
    return (
      <div className="space-y-8">
        <HeaderSkeleton />
        <TrackListSkeleton />
      </div>
    );
  }

  const likeAlbum = async () => {
    const res = await api<{ liked: boolean }>('/favorites', { method: 'POST', body: { type: 'ALBUM', id: album.id } });
    setData((prev) => (prev ? { ...prev, isLiked: res.liked } : prev));
    showToast(res.liked ? 'Added to your library' : 'Removed from your library');
  };

  return (
    <div className="space-y-8">
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
        <Artwork src={album.artUrl} alt={album.title} className="size-48 shadow-2xl" rounded="rounded-lg" />
        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{album.type}</div>
          <h1 className="text-4xl font-black">{album.title}</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
            <a href={`/artist/${album.artist.slug}`} className="font-semibold text-ink hover:underline">
              {album.artist.name}
            </a>
            <span>· {formatYear(album.releaseDate)}</span>
            <span>· {album.tracks?.length ?? album.trackCount} songs, {formatLongDuration(album.totalDurationMs ?? 0)}</span>
            {album.genres.length > 0 && <span>· {album.genres.map((g) => g.name).join(', ')}</span>}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void playTracks(album.tracks ?? [], 0, album.title)}
              className="flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 font-semibold text-white transition-transform hover:scale-105"
            >
              <PlayIcon size={18} /> Play
            </button>
            <button
              onClick={toggleShuffle}
              aria-label="Shuffle"
              className={`rounded-full border border-surface-2 p-2.5 ${shuffle ? 'text-accent' : 'text-ink-muted'}`}
            >
              <ShuffleIcon size={18} />
            </button>
            <button
              onClick={likeAlbum}
              aria-label={album.isLiked ? 'Remove from library' : 'Save to library'}
              className={`rounded-full border border-surface-2 p-2.5 ${album.isLiked ? 'text-accent' : 'text-ink-muted'}`}
            >
              <HeartIcon size={18} filled={album.isLiked} />
            </button>
          </div>
        </div>
      </motion.header>

      <TrackList
        tracks={album.tracks ?? []}
        contextLabel={album.title}
        onLikeChange={(trackId, liked) =>
          setData((prev) =>
            prev ? { ...prev, tracks: prev.tracks?.map((t) => (t.id === trackId ? { ...t, liked } : t)) } : prev,
          )
        }
      />

      {(album.credits?.length ?? 0) > 0 && (
        <section className="space-y-1 text-sm text-ink-muted">
          <h2 className="text-base font-bold text-ink">Credits</h2>
          {[...new Map(album.credits!.map((c) => [`${c.role}:${c.name}`, c])).values()].map((c, i) => (
            <div key={i}>
              <span className="capitalize">{c.role}</span>: {c.name}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

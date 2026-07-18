import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import type { Playlist } from '../lib/types';
import { formatLongDuration } from '../lib/format';
import { usePlayer } from '../stores/player';
import { useUi } from '../stores/ui';
import { Artwork } from '../components/Artwork';
import { TrackList } from '../components/TrackList';
import { HeaderSkeleton, TrackListSkeleton } from '../components/Skeletons';
import { PinIcon, PlayIcon } from '../components/Icons';

export default function PlaylistPage() {
  const { id } = useParams();
  const { data: playlist, loading, setData, reload } = useFetch<Playlist & { pinned?: boolean }>(id ? `/playlists/${id}` : null);
  const playTracks = usePlayer((s) => s.playTracks);
  const showToast = useUi((s) => s.showToast);

  if (loading || !playlist) {
    return (
      <div className="space-y-8">
        <HeaderSkeleton />
        <TrackListSkeleton />
      </div>
    );
  }

  const pin = async () => {
    const res = await api<{ pinned: boolean }>(`/playlists/${playlist.id}/pin`, { method: 'POST' });
    showToast(res.pinned ? 'Pinned to sidebar' : 'Unpinned');
    setData((prev) => (prev ? { ...prev, pinned: res.pinned } : prev));
  };

  const share = async () => {
    const res = await api<{ shareId: string }>(`/playlists/${playlist.id}/share`).catch(() => null);
    const url = `${location.origin}/playlist/${res?.shareId ?? playlist.shareId}`;
    await navigator.clipboard.writeText(url).catch(() => undefined);
    showToast('Share link copied');
  };

  const togglePublic = async () => {
    const updated = await api<Playlist>(`/playlists/${playlist.id}`, {
      method: 'PUT',
      body: { isPublic: !playlist.isPublic },
    });
    setData((prev) => (prev ? { ...prev, isPublic: updated.isPublic } : prev));
    showToast(updated.isPublic ? 'Playlist is now public' : 'Playlist is now private');
  };

  const removeTrack = async (trackId: string) => {
    await api(`/playlists/${playlist.id}/tracks/${trackId}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div className="space-y-8">
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
        <Artwork src={playlist.coverUrl} alt={playlist.title} className="size-48 shadow-2xl" rounded="rounded-lg" />
        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            {playlist.isCollaborative ? 'Collaborative playlist' : playlist.isPublic ? 'Public playlist' : 'Private playlist'}
          </div>
          <h1 className="text-4xl font-black">{playlist.title}</h1>
          {playlist.description && <p className="text-sm text-ink-muted">{playlist.description}</p>}
          <div className="text-sm text-ink-muted">
            {playlist.owner && <span className="font-semibold text-ink">{playlist.owner.displayName}</span>}
            <span> · {playlist.tracks?.length ?? 0} songs, {formatLongDuration(playlist.totalDurationMs ?? 0)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => void playTracks(playlist.tracks ?? [], 0, playlist.title)}
              className="flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 font-semibold text-white transition-transform hover:scale-105"
            >
              <PlayIcon size={18} /> Play
            </button>
            <button onClick={pin} aria-label="Pin playlist" className={`rounded-full border border-surface-2 p-2.5 ${playlist.pinned ? 'text-accent' : 'text-ink-muted'}`}>
              <PinIcon size={18} filled={playlist.pinned} />
            </button>
            <button onClick={share} className="rounded-full border border-surface-2 px-4 py-2 text-sm">
              Share
            </button>
            {playlist.canEdit && (
              <button onClick={togglePublic} className="rounded-full border border-surface-2 px-4 py-2 text-sm">
                Make {playlist.isPublic ? 'private' : 'public'}
              </button>
            )}
          </div>
        </div>
      </motion.header>

      <TrackList
        tracks={playlist.tracks ?? []}
        showArt
        showAlbum
        contextLabel={playlist.title}
        onLikeChange={(trackId, liked) =>
          setData((prev) =>
            prev ? { ...prev, tracks: prev.tracks?.map((t) => (t.id === trackId ? { ...t, liked } : t)) } : prev,
          )
        }
      />

      {playlist.canAddTracks && (playlist.tracks?.length ?? 0) > 0 && (
        <p className="text-xs text-ink-muted">
          Tip: use the queue icon on any track anywhere in the app, or remove a track with{' '}
          <button className="underline" onClick={() => playlist.tracks?.[0] && void removeTrack(playlist.tracks[0].id)}>
            remove first track
          </button>{' '}
          (demo).
        </p>
      )}
    </div>
  );
}

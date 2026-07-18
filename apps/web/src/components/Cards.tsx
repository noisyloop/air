import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { Album, Artist, Playlist, Track } from '../lib/types';
import { Artwork } from './Artwork';
import { PlayIcon } from './Icons';
import { usePlayer } from '../stores/player';
import { api } from '../lib/api';

const cardMotion = {
  whileHover: { y: -4 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
};

function CardShell({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <motion.div {...cardMotion} className="w-40 shrink-0">
      <Link to={to} className="block space-y-2 rounded-lg bg-surface-1 p-3 transition-colors hover:bg-surface-2">
        {children}
      </Link>
    </motion.div>
  );
}

export function AlbumCard({ album }: { album: Album }) {
  return (
    <CardShell to={`/album/${album.slug}`}>
      <Artwork src={album.artUrl} alt={album.title} className="aspect-square w-full" />
      <div>
        <div className="line-clamp-1 text-sm font-semibold">{album.title}</div>
        <div className="line-clamp-1 text-xs text-ink-muted">{album.artist.name}</div>
      </div>
    </CardShell>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <CardShell to={`/artist/${artist.slug}`}>
      <Artwork src={artist.imageUrl} alt={artist.name} className="aspect-square w-full" rounded="rounded-full" />
      <div>
        <div className="line-clamp-1 text-sm font-semibold">{artist.name}</div>
        <div className="text-xs text-ink-muted">Artist</div>
      </div>
    </CardShell>
  );
}

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  return (
    <CardShell to={`/playlist/${playlist.id}`}>
      <Artwork src={playlist.coverUrl} alt={playlist.title} className="aspect-square w-full" />
      <div>
        <div className="line-clamp-1 text-sm font-semibold">{playlist.title}</div>
        <div className="line-clamp-1 text-xs text-ink-muted">
          {playlist.owner ? `By ${playlist.owner.displayName}` : `${playlist.trackCount ?? 0} tracks`}
        </div>
      </div>
    </CardShell>
  );
}

/** Track card with hover play button (used on Home rows). */
export function TrackCard({ track, tracks }: { track: Track; tracks: Track[] }) {
  const playTracks = usePlayer((s) => s.playTracks);
  const play = async (e: React.MouseEvent) => {
    e.preventDefault();
    // Play this row as the queue, starting at the clicked track.
    const idx = tracks.findIndex((t) => t.id === track.id);
    await playTracks(tracks, Math.max(0, idx));
    void api('/history', {
      method: 'POST',
      body: { trackId: track.id, msPlayed: 0, completed: false, source: 'RECOMMENDATION' },
    }).catch(() => undefined);
  };
  return (
    <motion.div {...cardMotion} className="group relative w-40 shrink-0">
      <Link to={`/album/${track.album?.slug ?? ''}`} className="block space-y-2 rounded-lg bg-surface-1 p-3 transition-colors hover:bg-surface-2">
        <div className="relative">
          <Artwork src={track.album?.artUrl} alt={track.title} className="aspect-square w-full" />
          <button
            onClick={play}
            aria-label={`Play ${track.title}`}
            className="absolute right-2 bottom-2 flex size-10 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
          >
            <PlayIcon size={18} />
          </button>
        </div>
        <div>
          <div className="line-clamp-1 text-sm font-semibold">{track.title}</div>
          <div className="line-clamp-1 text-xs text-ink-muted">{track.artist.name}</div>
        </div>
      </Link>
    </motion.div>
  );
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{title}</h2>
        {action}
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">{children}</div>
    </section>
  );
}

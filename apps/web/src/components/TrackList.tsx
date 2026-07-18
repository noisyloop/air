import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Track } from '../lib/types';
import { formatDuration } from '../lib/format';
import { usePlayer } from '../stores/player';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { Artwork } from './Artwork';
import { HeartIcon, PauseIcon, PlayIcon, QueueIcon } from './Icons';
import { VirtualList } from './VirtualList';

interface Props {
  tracks: Track[];
  contextLabel?: string;
  showAlbum?: boolean;
  showArt?: boolean;
  onLikeChange?: (trackId: string, liked: boolean) => void;
}

const ROW_HEIGHT = 56;

function TrackRow({
  track,
  index,
  tracks,
  contextLabel,
  showAlbum,
  showArt,
  onLikeChange,
}: Props & { track: Track; index: number }) {
  const { current, playing, playTracks, toggle, addToQueue } = usePlayer();
  const user = useAuth((s) => s.user);
  const showToast = useUi((s) => s.showToast);
  const isCurrent = current()?.id === track.id;

  const onPlay = () => {
    if (isCurrent) toggle();
    else void playTracks(tracks, index, contextLabel);
  };

  const onLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return showToast('Log in to like tracks');
    const res = await api<{ liked: boolean }>('/favorites', { method: 'POST', body: { type: 'TRACK', id: track.id } });
    onLikeChange?.(track.id, res.liked);
    showToast(res.liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
  };

  return (
    <div
      onDoubleClick={onPlay}
      className={`group flex h-full items-center gap-3 rounded-md px-3 hover:bg-surface-1 ${isCurrent ? 'text-accent' : ''}`}
    >
      <button
        onClick={onPlay}
        aria-label={isCurrent && playing ? 'Pause' : `Play ${track.title}`}
        className="relative flex w-6 shrink-0 items-center justify-center text-ink-muted"
      >
        <span className={`text-sm tabular-nums group-hover:invisible ${isCurrent ? 'invisible' : ''}`}>{index + 1}</span>
        <span className={`absolute inset-0 hidden items-center justify-center group-hover:flex ${isCurrent ? 'flex' : ''}`}>
          {isCurrent && playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </span>
      </button>
      {showArt && <Artwork src={track.album?.artUrl} className="size-10 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className={`line-clamp-1 text-sm font-medium ${isCurrent ? '' : 'text-ink'}`}>
          {track.title}
          {track.explicit && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] text-ink-muted">E</span>}
        </div>
        <Link
          to={`/artist/${track.artist.slug}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-ink-muted hover:underline"
        >
          {track.artist.name}
        </Link>
      </div>
      {showAlbum && track.album && (
        <Link
          to={`/album/${track.album.slug}`}
          className="line-clamp-1 hidden w-1/4 text-xs text-ink-muted hover:underline md:block"
        >
          {track.album.title}
        </Link>
      )}
      <button
        onClick={() => {
          addToQueue([track]);
          showToast('Added to queue');
        }}
        aria-label="Add to queue"
        className="invisible text-ink-muted hover:text-ink group-hover:visible"
      >
        <QueueIcon size={16} />
      </button>
      <button
        onClick={onLike}
        aria-label={track.liked ? 'Unlike' : 'Like'}
        className={`${track.liked ? 'text-accent' : 'invisible text-ink-muted group-hover:visible'} hover:text-accent`}
      >
        <HeartIcon size={16} filled={track.liked} />
      </button>
      <span className="w-10 text-right text-xs tabular-nums text-ink-muted">{formatDuration(track.durationMs)}</span>
    </div>
  );
}

/** Virtualized track table used across album/playlist/library/search pages. */
export function TrackList(props: Props) {
  const { tracks } = props;
  if (tracks.length === 0) {
    return <p className="px-3 py-8 text-sm text-ink-muted">No tracks here yet.</p>;
  }
  return (
    <VirtualList
      items={tracks}
      rowHeight={ROW_HEIGHT}
      renderRow={(track, index) => <TrackRow {...props} track={track} index={index} />}
    />
  );
}

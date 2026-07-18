import { usePlayer } from '../stores/player';
import { formatDuration } from '../lib/format';
import { Artwork } from '../components/Artwork';
import { PlayIcon, XIcon } from '../components/Icons';

export default function QueuePage() {
  const p = usePlayer();
  const track = p.current();

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black">Queue</h1>
        {p.queue.length > 1 && (
          <button onClick={p.clearQueue} className="text-sm text-ink-muted hover:text-ink">
            Clear queue
          </button>
        )}
      </div>

      {track && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wider text-ink-muted uppercase">Now playing</h2>
          <div className="flex items-center gap-3 rounded-lg bg-surface-1 p-3">
            <Artwork src={track.album?.artUrl} className="size-12" />
            <div className="flex-1">
              <div className="font-medium text-accent">{track.title}</div>
              <div className="text-sm text-ink-muted">{track.artist.name}</div>
            </div>
            <span className="text-xs tabular-nums text-ink-muted">{formatDuration(track.durationMs)}</span>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wider text-ink-muted uppercase">Next up</h2>
        {p.queue.length <= p.index + 1 && <p className="text-sm text-ink-muted">Nothing queued. Add tracks from anywhere with the queue icon.</p>}
        {p.queue.slice(p.index + 1).map((t, i) => {
          const absoluteIndex = p.index + 1 + i;
          return (
            <div key={`${t.id}-${absoluteIndex}`} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-1">
              <span className="w-5 text-sm tabular-nums text-ink-muted">{i + 1}</span>
              <Artwork src={t.album?.artUrl} className="size-10" />
              <div className="flex-1">
                <div className="text-sm font-medium">{t.title}</div>
                <div className="text-xs text-ink-muted">{t.artist.name}</div>
              </div>
              <button
                onClick={() => void p.playTracks(p.queue, absoluteIndex)}
                aria-label="Play now"
                className="invisible text-ink-muted hover:text-ink group-hover:visible"
              >
                <PlayIcon size={16} />
              </button>
              <button
                onClick={() => p.removeFromQueue(absoluteIndex)}
                aria-label="Remove from queue"
                className="invisible text-ink-muted hover:text-ink group-hover:visible"
              >
                <XIcon size={16} />
              </button>
              <span className="text-xs tabular-nums text-ink-muted">{formatDuration(t.durationMs)}</span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

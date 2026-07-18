import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { usePlayer } from '../stores/player';
import { useUi } from '../stores/ui';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';
import { Artwork } from './Artwork';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, XIcon } from './Icons';

function Waveform({ trackId, progress }: { trackId: string; progress: number }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    void api<{ waveformUrl: string | null }>(`/tracks/${trackId}`)
      .then(async (t) => {
        if (!t.waveformUrl) return;
        const res = await fetch(t.waveformUrl);
        const data = (await res.json()) as { peaks: number[] };
        if (!cancelled) setPeaks(data.peaks);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  const bars = peaks ?? Array.from({ length: 120 }, (_, i) => 0.3 + 0.25 * Math.abs(Math.sin(i / 5)));
  const step = Math.max(1, Math.floor(bars.length / 120));
  const shown = bars.filter((_, i) => i % step === 0);
  return (
    <div className="flex h-16 items-end gap-0.5" aria-hidden>
      {shown.map((v, i) => (
        <div
          key={i}
          style={{ height: `${Math.max(6, v * 100)}%` }}
          className={`w-1 rounded-sm ${i / shown.length <= progress ? 'bg-accent' : 'bg-surface-2'}`}
        />
      ))}
    </div>
  );
}

export function FullscreenPlayer() {
  const p = usePlayer();
  const { fullscreenPlayer, setFullscreenPlayer } = useUi();
  const track = p.current();

  return (
    <AnimatePresence>
      {fullscreenPlayer && track && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-surface-0 p-8"
        >
          <button
            onClick={() => setFullscreenPlayer(false)}
            aria-label="Close fullscreen player"
            className="absolute top-6 right-6 text-ink-muted hover:text-ink"
          >
            <XIcon size={24} />
          </button>

          <motion.div
            key={track.id}
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm"
          >
            <Artwork src={track.album?.artUrl} alt={track.title} className="aspect-square w-full shadow-2xl" rounded="rounded-xl" />
          </motion.div>

          <div className="text-center">
            <h2 className="text-2xl font-bold">{track.title}</h2>
            <Link
              to={`/artist/${track.artist.slug}`}
              onClick={() => setFullscreenPlayer(false)}
              className="text-ink-muted hover:underline"
            >
              {track.artist.name}
            </Link>
          </div>

          <div className="w-full max-w-xl space-y-2">
            <Waveform trackId={track.id} progress={p.durationMs ? p.positionMs / p.durationMs : 0} />
            <input
              type="range"
              aria-label="Seek"
              min={0}
              max={p.durationMs || 1}
              value={p.positionMs}
              onChange={(e) => p.seek(Number(e.target.value))}
              className="accent-accent"
            />
            <div className="flex justify-between text-xs tabular-nums text-ink-muted">
              <span>{formatDuration(p.positionMs)}</span>
              <span>{formatDuration(p.durationMs || track.durationMs)}</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <button onClick={p.toggleShuffle} className={p.shuffle ? 'text-accent' : 'text-ink-muted'} aria-label="Shuffle">
              <ShuffleIcon size={20} />
            </button>
            <button onClick={() => void p.previous()} aria-label="Previous" className="hover:text-accent">
              <PrevIcon size={28} />
            </button>
            <button
              onClick={p.toggle}
              aria-label={p.playing ? 'Pause' : 'Play'}
              className="flex size-14 items-center justify-center rounded-full bg-ink text-surface-0 transition-transform hover:scale-105"
            >
              {p.playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
            </button>
            <button onClick={() => void p.next()} aria-label="Next" className="hover:text-accent">
              <NextIcon size={28} />
            </button>
            <button onClick={p.cycleRepeat} className={p.repeat !== 'off' ? 'text-accent' : 'text-ink-muted'} aria-label="Repeat">
              <RepeatIcon size={20} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

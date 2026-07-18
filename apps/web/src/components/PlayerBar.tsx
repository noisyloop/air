import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { usePlayer } from '../stores/player';
import { useUi } from '../stores/ui';
import { formatDuration } from '../lib/format';
import { Artwork } from './Artwork';
import {
  ClockIcon,
  ExpandIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ShuffleIcon,
  SpeedIcon,
  VolumeIcon,
} from './Icons';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [15, 30, 60, null] as const;

/** Persistent bottom player bar (mini player). */
export function PlayerBar() {
  const p = usePlayer();
  const setFullscreen = useUi((s) => s.setFullscreenPlayer);
  const [menu, setMenu] = useState<'speed' | 'sleep' | null>(null);
  const track = p.current();
  if (!track) return null;

  return (
    <motion.footer
      initial={{ y: 90 }}
      animate={{ y: 0 }}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-2 bg-surface-1/95 backdrop-blur"
    >
      {/* seek bar */}
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={p.durationMs || track.durationMs || 1}
        value={p.positionMs}
        onChange={(e) => p.seek(Number(e.target.value))}
        className="absolute -top-0.5 left-0 accent-accent"
      />
      <div className="flex items-center gap-4 px-4 py-2.5">
        {/* now playing */}
        <div className="flex w-56 min-w-0 items-center gap-3">
          <button onClick={() => setFullscreen(true)} aria-label="Open fullscreen player" className="shrink-0">
            <Artwork src={track.album?.artUrl} className="size-11" />
          </button>
          <div className="min-w-0">
            <div className="line-clamp-1 text-sm font-medium">{track.title}</div>
            <Link to={`/artist/${track.artist.slug}`} className="line-clamp-1 text-xs text-ink-muted hover:underline">
              {track.artist.name}
            </Link>
          </div>
        </div>

        {/* transport */}
        <div className="flex flex-1 items-center justify-center gap-4">
          <button
            onClick={p.toggleShuffle}
            aria-label="Shuffle"
            className={p.shuffle ? 'text-accent' : 'text-ink-muted hover:text-ink'}
          >
            <ShuffleIcon size={16} />
          </button>
          <button onClick={() => void p.previous()} aria-label="Previous" className="text-ink-muted hover:text-ink">
            <PrevIcon size={20} />
          </button>
          <button
            onClick={p.toggle}
            aria-label={p.playing ? 'Pause' : 'Play'}
            className="flex size-9 items-center justify-center rounded-full bg-ink text-surface-0 transition-transform hover:scale-105"
          >
            {p.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          <button onClick={() => void p.next()} aria-label="Next" className="text-ink-muted hover:text-ink">
            <NextIcon size={20} />
          </button>
          <button
            onClick={p.cycleRepeat}
            aria-label={`Repeat: ${p.repeat}`}
            className={p.repeat !== 'off' ? 'relative text-accent' : 'text-ink-muted hover:text-ink'}
          >
            <RepeatIcon size={16} />
            {p.repeat === 'one' && <span className="absolute -top-1 -right-1 text-[9px] font-bold">1</span>}
          </button>
          <span className="hidden w-24 text-center text-xs tabular-nums text-ink-muted sm:block">
            {formatDuration(p.positionMs)} / {formatDuration(p.durationMs || track.durationMs)}
          </span>
        </div>

        {/* right controls */}
        <div className="relative flex w-56 items-center justify-end gap-3">
          {/* speed */}
          <button
            onClick={() => setMenu(menu === 'speed' ? null : 'speed')}
            aria-label="Playback speed"
            className={p.speed !== 1 ? 'text-accent' : 'text-ink-muted hover:text-ink'}
          >
            <SpeedIcon size={16} />
          </button>
          {/* sleep timer */}
          <button
            onClick={() => setMenu(menu === 'sleep' ? null : 'sleep')}
            aria-label="Sleep timer"
            className={p.sleepAt ? 'text-accent' : 'text-ink-muted hover:text-ink'}
          >
            <ClockIcon size={16} />
          </button>
          <Link to="/queue" aria-label="Queue" className="text-ink-muted hover:text-ink">
            <QueueIcon size={16} />
          </Link>
          <button onClick={p.toggleMute} aria-label="Mute" className="text-ink-muted hover:text-ink">
            <VolumeIcon size={16} muted={p.muted} />
          </button>
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.01}
            value={p.muted ? 0 : p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))}
            className="hidden w-20 accent-accent md:block"
          />
          <button onClick={() => setFullscreen(true)} aria-label="Fullscreen player" className="text-ink-muted hover:text-ink">
            <ExpandIcon size={16} />
          </button>

          <AnimatePresence>
            {menu && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="absolute right-0 bottom-10 w-36 rounded-lg border border-surface-2 bg-surface-1 p-1 shadow-xl"
              >
                {menu === 'speed'
                  ? SPEEDS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          p.setSpeed(s);
                          setMenu(null);
                        }}
                        className={`block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-surface-2 ${p.speed === s ? 'text-accent' : ''}`}
                      >
                        {s}×
                      </button>
                    ))
                  : SLEEP_OPTIONS.map((m) => (
                      <button
                        key={String(m)}
                        onClick={() => {
                          p.setSleepTimer(m);
                          setMenu(null);
                        }}
                        className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                      >
                        {m ? `${m} min` : 'Off'}
                      </button>
                    ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.footer>
  );
}

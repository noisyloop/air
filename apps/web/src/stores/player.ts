/**
 * Headless playback engine around a singleton <audio> element.
 * Queue, shuffle, repeat, volume, speed, sleep timer, resume, and
 * server-side progress/history reporting all live here.
 */
import { create } from 'zustand';
import { api, streamUrl } from '../lib/api';
import type { Track } from '../lib/types';

export type RepeatMode = 'off' | 'all' | 'one';
export type Quality = 'auto' | 'high' | 'med' | 'low';

interface PlayerState {
  queue: Track[];
  index: number; // position in queue
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  speed: number;
  shuffle: boolean;
  repeat: RepeatMode;
  quality: Quality;
  sleepAt: number | null; // epoch ms
  sessionId: string | null;
  contextLabel: string | null;

  current: () => Track | null;
  playTracks: (tracks: Track[], startIndex?: number, contextLabel?: string) => Promise<void>;
  playNext: (tracks: Track[]) => void;
  addToQueue: (tracks: Track[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  toggle: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setSpeed: (s: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setQuality: (q: Quality) => void;
  setSleepTimer: (minutes: number | null) => void;
  resumeFromServer: () => Promise<void>;
}

const audio = new Audio();
audio.preload = 'auto';

let heartbeat: ReturnType<typeof setInterval> | undefined;
let playedMsThisTrack = 0;
let lastTick = 0;

function shuffleArray<T>(arr: T[], keepFirst: number): T[] {
  const head = arr.slice(0, keepFirst + 1);
  const rest = arr.slice(keepFirst + 1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [...head, ...rest];
}

export const usePlayer = create<PlayerState>((set, get) => {
  async function loadAndPlay(track: Track, startAtMs = 0): Promise<void> {
    try {
      const { token } = await api<{ token: string }>(`/tracks/${track.id}/stream-token`, { method: 'POST' });
      const state = get();
      const sess = state.sessionId ? `&session=${state.sessionId}` : '';
      audio.src = `${streamUrl(track.id, token, state.quality)}${sess}`;
      audio.currentTime = startAtMs / 1000;
      audio.playbackRate = state.speed;
      playedMsThisTrack = 0;
      await audio.play();
      set({ playing: true, durationMs: track.durationMs, positionMs: startAtMs });
    } catch {
      set({ playing: false });
    }
  }

  function reportPlay(completed: boolean): void {
    const track = get().current();
    if (!track || playedMsThisTrack < 1000) return;
    void api('/history', {
      method: 'POST',
      body: {
        trackId: track.id,
        msPlayed: Math.round(Math.min(playedMsThisTrack, track.durationMs || playedMsThisTrack)),
        completed,
        source: 'QUEUE',
      },
    }).catch(() => undefined);
  }

  function persistProgress(): void {
    const s = get();
    const track = s.current();
    void api('/history/progress', {
      method: 'POST',
      body: {
        trackId: track?.id ?? null,
        positionMs: Math.round(audio.currentTime * 1000),
        queue: { trackIds: s.queue.map((t) => t.id).slice(0, 500), index: s.index },
        sessionId: s.sessionId ?? undefined,
        deltaMs: s.playing ? 15_000 : 0,
      },
    }).catch(() => undefined);
  }

  audio.addEventListener('timeupdate', () => {
    const now = performance.now();
    if (get().playing && lastTick) playedMsThisTrack += Math.min(2000, now - lastTick);
    lastTick = now;
    set({ positionMs: audio.currentTime * 1000, durationMs: (audio.duration || 0) * 1000 || get().durationMs });
    const sleepAt = get().sleepAt;
    if (sleepAt && Date.now() >= sleepAt) {
      audio.pause();
      set({ playing: false, sleepAt: null });
    }
  });

  audio.addEventListener('ended', () => {
    reportPlay(true);
    const s = get();
    if (s.repeat === 'one') {
      void loadAndPlay(s.current()!);
      return;
    }
    void s.next();
  });

  audio.addEventListener('pause', () => set({ playing: false }));
  audio.addEventListener('play', () => {
    lastTick = performance.now();
    set({ playing: true });
    if (!heartbeat) heartbeat = setInterval(persistProgress, 15_000);
  });

  return {
    queue: [],
    index: 0,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    volume: Number(localStorage.getItem('air.volume') ?? 0.9),
    muted: false,
    speed: 1,
    shuffle: false,
    repeat: 'off',
    quality: (localStorage.getItem('air.quality') as Quality | null) ?? 'auto',
    sleepAt: null,
    sessionId: null,
    contextLabel: null,

    current() {
      return get().queue[get().index] ?? null;
    },

    async playTracks(tracks, startIndex = 0, contextLabel) {
      if (tracks.length === 0) return;
      reportPlay(false);
      if (!get().sessionId) {
        const res = await api<{ sessionId: string }>('/history/sessions', {
          method: 'POST',
          body: { deviceName: 'web' },
        }).catch(() => null);
        if (res) set({ sessionId: res.sessionId });
      }
      const queue = get().shuffle ? shuffleArray(tracks, startIndex) : tracks;
      set({ queue, index: get().shuffle ? 0 : startIndex, contextLabel: contextLabel ?? null });
      audio.volume = get().muted ? 0 : get().volume;
      await loadAndPlay(queue[get().index]!);
    },

    playNext(tracks) {
      const s = get();
      const queue = [...s.queue];
      queue.splice(s.index + 1, 0, ...tracks);
      set({ queue });
    },

    addToQueue(tracks) {
      set({ queue: [...get().queue, ...tracks] });
    },

    removeFromQueue(index) {
      const s = get();
      if (index === s.index) return; // can't remove the playing track
      const queue = s.queue.filter((_, i) => i !== index);
      set({ queue, index: index < s.index ? s.index - 1 : s.index });
    },

    clearQueue() {
      const s = get();
      const track = s.current();
      set({ queue: track ? [track] : [], index: 0 });
    },

    toggle() {
      if (!get().current()) return;
      if (audio.paused) void audio.play();
      else audio.pause();
    },

    async next() {
      reportPlay(false);
      const s = get();
      let nextIndex = s.index + 1;
      if (nextIndex >= s.queue.length) {
        if (s.repeat === 'all' && s.queue.length > 0) nextIndex = 0;
        else {
          set({ playing: false });
          return;
        }
      }
      set({ index: nextIndex });
      await loadAndPlay(s.queue[nextIndex]!);
    },

    async previous() {
      // Within the first 3s: go to previous track, else restart current.
      if (audio.currentTime > 3 || get().index === 0) {
        audio.currentTime = 0;
        return;
      }
      reportPlay(false);
      const prevIndex = get().index - 1;
      set({ index: prevIndex });
      await loadAndPlay(get().queue[prevIndex]!);
    },

    seek(ms) {
      audio.currentTime = ms / 1000;
      set({ positionMs: ms });
    },

    setVolume(v) {
      localStorage.setItem('air.volume', String(v));
      audio.volume = v;
      set({ volume: v, muted: false });
    },

    toggleMute() {
      const muted = !get().muted;
      audio.volume = muted ? 0 : get().volume;
      set({ muted });
    },

    setSpeed(speed) {
      audio.playbackRate = speed;
      set({ speed });
    },

    toggleShuffle() {
      const s = get();
      if (!s.shuffle && s.queue.length > 1) {
        // Shuffle the remainder of the queue, keeping the current track first.
        const current = s.current();
        const rest = s.queue.filter((_, i) => i !== s.index);
        const shuffled = shuffleArray(rest, -1);
        set({ queue: current ? [current, ...shuffled] : shuffled, index: 0, shuffle: true });
      } else {
        set({ shuffle: !s.shuffle });
      }
    },

    cycleRepeat() {
      const order: RepeatMode[] = ['off', 'all', 'one'];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3]! });
    },

    setQuality(quality) {
      localStorage.setItem('air.quality', quality);
      const track = get().current();
      const at = audio.currentTime * 1000;
      set({ quality });
      // Re-request the stream at the new quality, resuming position.
      if (track && !audio.paused) void loadAndPlay(track, at);
    },

    setSleepTimer(minutes) {
      set({ sleepAt: minutes ? Date.now() + minutes * 60_000 : null });
    },

    async resumeFromServer() {
      const res = await api<{
        track: Track | null;
        positionMs: number;
        queue: { trackIds: string[]; index: number } | null;
      }>('/history/resume').catch(() => null);
      if (!res?.track) return;
      set({ queue: [res.track], index: 0, positionMs: res.positionMs, durationMs: res.track.durationMs });
      // Don't autoplay on load — just surface the track in the player bar.
    },
  };
});

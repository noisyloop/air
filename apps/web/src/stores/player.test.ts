import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayer } from './player';
import type { Track } from '../lib/types';

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  slug: id,
  durationMs: 30_000,
  trackNumber: 1,
  explicit: false,
  popularity: 0,
  artist: { id: 'a', name: 'Artist', slug: 'artist' },
  genres: [],
});

describe('player store queue logic', () => {
  beforeEach(() => {
    usePlayer.setState({ queue: [], index: 0, shuffle: false, repeat: 'off', playing: false });
  });

  it('addToQueue appends to the end', () => {
    usePlayer.setState({ queue: [track('1')], index: 0 });
    usePlayer.getState().addToQueue([track('2'), track('3')]);
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('playNext inserts directly after the current track', () => {
    usePlayer.setState({ queue: [track('1'), track('2')], index: 0 });
    usePlayer.getState().playNext([track('9')]);
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(['1', '9', '2']);
  });

  it('removeFromQueue keeps the playing index stable', () => {
    usePlayer.setState({ queue: [track('1'), track('2'), track('3')], index: 1 });
    usePlayer.getState().removeFromQueue(0); // remove before current
    const s = usePlayer.getState();
    expect(s.queue.map((t) => t.id)).toEqual(['2', '3']);
    expect(s.index).toBe(0);
    expect(s.current()?.id).toBe('2');
  });

  it('refuses to remove the currently playing track', () => {
    usePlayer.setState({ queue: [track('1'), track('2')], index: 0 });
    usePlayer.getState().removeFromQueue(0);
    expect(usePlayer.getState().queue).toHaveLength(2);
  });

  it('clearQueue keeps only the current track', () => {
    usePlayer.setState({ queue: [track('1'), track('2'), track('3')], index: 1 });
    usePlayer.getState().clearQueue();
    const s = usePlayer.getState();
    expect(s.queue.map((t) => t.id)).toEqual(['2']);
    expect(s.index).toBe(0);
  });

  it('toggleShuffle keeps the current track first', () => {
    usePlayer.setState({ queue: [track('1'), track('2'), track('3'), track('4')], index: 2 });
    usePlayer.getState().toggleShuffle();
    const s = usePlayer.getState();
    expect(s.shuffle).toBe(true);
    expect(s.index).toBe(0);
    expect(s.current()?.id).toBe('3');
    expect(s.queue).toHaveLength(4);
    expect(new Set(s.queue.map((t) => t.id))).toEqual(new Set(['1', '2', '3', '4']));
  });

  it('cycleRepeat walks off → all → one → off', () => {
    const s = usePlayer.getState();
    s.cycleRepeat();
    expect(usePlayer.getState().repeat).toBe('all');
    usePlayer.getState().cycleRepeat();
    expect(usePlayer.getState().repeat).toBe('one');
    usePlayer.getState().cycleRepeat();
    expect(usePlayer.getState().repeat).toBe('off');
  });
});

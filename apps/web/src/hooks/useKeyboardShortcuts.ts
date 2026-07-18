import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../stores/player';
import { useUi } from '../stores/ui';

/**
 * Global shortcuts:
 *  Space play/pause · →/← seek ±10s · Shift+→/← next/prev · ↑/↓ volume ·
 *  M mute · S shuffle · R repeat · F fullscreen player · / focus search · T theme
 */
export function useKeyboardShortcuts(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const p = usePlayer.getState();
      const ui = useUi.getState();

      switch (e.key) {
        case ' ':
          e.preventDefault();
          p.toggle();
          break;
        case 'ArrowRight':
          if (e.shiftKey) void p.next();
          else p.seek(Math.min(p.durationMs, p.positionMs + 10_000));
          break;
        case 'ArrowLeft':
          if (e.shiftKey) void p.previous();
          else p.seek(Math.max(0, p.positionMs - 10_000));
          break;
        case 'ArrowUp':
          e.preventDefault();
          p.setVolume(Math.min(1, p.volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          p.setVolume(Math.max(0, p.volume - 0.05));
          break;
        case 'm':
          p.toggleMute();
          break;
        case 's':
          p.toggleShuffle();
          break;
        case 'r':
          p.cycleRepeat();
          break;
        case 'f':
          ui.setFullscreenPlayer(!ui.fullscreenPlayer);
          break;
        case 't':
          ui.toggleTheme();
          break;
        case '/':
          e.preventDefault();
          navigate('/search');
          setTimeout(() => document.getElementById('search-input')?.focus(), 50);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}

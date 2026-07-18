import { useEffect, useRef } from 'react';
import { getAccessToken, WS_URL } from '../lib/api';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';

/**
 * Realtime channel: connects when logged in, reconnects with backoff, and
 * surfaces incoming notifications as toasts + a refresh signal.
 */
export function useWs(onNotification?: () => void): void {
  const user = useAuth((s) => s.user);
  const showToast = useUi((s) => s.showToast);
  const callbackRef = useRef(onNotification);
  callbackRef.current = onNotification;

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempts = 0;
    let pinger: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const token = getAccessToken();
      if (!token || closed) return;
      ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        attempts = 0;
        pinger = setInterval(() => ws?.readyState === ws?.OPEN && ws?.send('ping'), 25_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { kind: string; notification?: { title: string } };
          if (msg.kind === 'notification' && msg.notification) {
            showToast(msg.notification.title);
            callbackRef.current?.();
          }
        } catch {
          /* pong or malformed — ignore */
        }
      };
      ws.onclose = () => {
        clearInterval(pinger);
        if (!closed) setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts++));
      };
    };
    connect();

    return () => {
      closed = true;
      clearInterval(pinger);
      ws?.close();
    };
  }, [user, showToast]);
}

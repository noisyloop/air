import type { WebSocket } from 'ws';
import { redis, redisSub, CHANNELS } from './redis.js';

/**
 * WebSocket hub. Sockets register per user; cross-instance delivery goes through
 * Redis pub/sub so any API replica can push to clients connected elsewhere.
 */
const sockets = new Map<string, Set<WebSocket>>();
let subscribed = false;

export function registerSocket(userId: string, socket: WebSocket): void {
  let set = sockets.get(userId);
  if (!set) {
    set = new Set();
    sockets.set(userId, set);
  }
  set.add(socket);
  socket.on('close', () => {
    set.delete(socket);
    if (set.size === 0) sockets.delete(userId);
  });
}

function deliverLocal(userId: string, message: unknown): void {
  const set = sockets.get(userId);
  if (!set) return;
  const raw = JSON.stringify(message);
  for (const s of set) {
    if (s.readyState === s.OPEN) s.send(raw);
  }
}

/** Publish an event to a user's sockets on every API instance. */
export async function pushToUser(userId: string, message: unknown): Promise<void> {
  await redis.publish(CHANNELS.notifications, JSON.stringify({ userId, message }));
}

export function startWsBridge(): void {
  if (subscribed) return;
  subscribed = true;
  void redisSub.subscribe(CHANNELS.notifications);
  redisSub.on('message', (channel, raw) => {
    if (channel !== CHANNELS.notifications) return;
    try {
      const { userId, message } = JSON.parse(raw) as { userId: string; message: unknown };
      deliverLocal(userId, message);
    } catch {
      /* malformed message — drop */
    }
  });
}

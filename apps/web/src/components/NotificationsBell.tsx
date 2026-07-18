import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api';
import type { AppNotification, Page } from '../lib/types';
import { useFetch } from '../hooks/useFetch';
import { useWs } from '../hooks/useWs';
import { formatDate } from '../lib/format';
import { BellIcon } from './Icons';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useFetch<Page<AppNotification> & { unreadCount: number }>('/notifications?limit=15');
  useWs(reload);

  const markAllRead = async () => {
    await api('/notifications/read', { method: 'POST', body: {} });
    reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${data?.unreadCount ? ` (${data.unreadCount} unread)` : ''}`}
        className="relative text-ink-muted hover:text-ink"
      >
        <BellIcon size={20} />
        {!!data?.unreadCount && (
          <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
            {Math.min(9, data.unreadCount)}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute top-9 right-0 z-50 w-80 rounded-xl border border-surface-2 bg-surface-1 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-surface-2 px-4 py-2.5">
              <span className="text-sm font-semibold">Notifications</span>
              <button onClick={markAllRead} className="text-xs text-accent hover:underline">
                Mark all read
              </button>
            </div>
            <ul className="max-h-96 overflow-y-auto py-1">
              {data?.items.length ? (
                data.items.map((n) => (
                  <li key={n.id} className={`px-4 py-2.5 ${n.readAt ? 'opacity-60' : ''}`}>
                    <div className="text-sm">{n.title}</div>
                    {n.body && <div className="text-xs text-ink-muted">{n.body}</div>}
                    <div className="mt-0.5 text-[10px] text-ink-muted">{formatDate(n.createdAt)}</div>
                  </li>
                ))
              ) : (
                <li className="px-4 py-6 text-center text-sm text-ink-muted">You're all caught up</li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

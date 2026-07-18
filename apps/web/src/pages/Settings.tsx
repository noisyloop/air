import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { usePlayer, type Quality } from '../stores/player';
import { useUi } from '../stores/ui';
import { formatDate } from '../lib/format';

interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export default function Settings() {
  const { theme, setTheme, showToast } = useUi();
  const { quality, setQuality } = usePlayer();
  const { data: sessions, reload } = useFetch<{ items: Session[] }>('/auth/sessions');

  const revoke = async (id: string) => {
    await api(`/auth/sessions/${id}`, { method: 'DELETE' });
    showToast('Session revoked');
    reload();
  };

  return (
    <div className="max-w-xl space-y-10">
      <h1 className="text-3xl font-black">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Appearance</h2>
        <div className="flex gap-2">
          {(['dark', 'light'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`rounded-full px-5 py-2 text-sm font-medium capitalize ${
                theme === t ? 'bg-ink text-surface-0' : 'bg-surface-1'
              }`}
            >
              {t} mode
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Streaming quality</h2>
        <p className="text-sm text-ink-muted">Higher quality uses more bandwidth. “Auto” picks the best available encode.</p>
        <div className="flex gap-2">
          {(['auto', 'high', 'med', 'low'] as Quality[]).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`rounded-full px-5 py-2 text-sm font-medium capitalize ${
                quality === q ? 'bg-ink text-surface-0' : 'bg-surface-1'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink-muted">
          {[
            ['Space', 'Play / pause'],
            ['← / →', 'Seek 10s'],
            ['Shift + ← / →', 'Previous / next'],
            ['↑ / ↓', 'Volume'],
            ['M', 'Mute'],
            ['S', 'Shuffle'],
            ['R', 'Repeat'],
            ['F', 'Fullscreen player'],
            ['T', 'Toggle theme'],
            ['/', 'Search'],
          ].map(([key, label]) => (
            <div key={key} className="flex justify-between">
              <kbd className="rounded bg-surface-1 px-2 py-0.5 font-mono text-xs">{key}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Active sessions</h2>
        <ul className="space-y-2">
          {sessions?.items.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-lg bg-surface-1 px-4 py-3 text-sm">
              <div>
                <div className="line-clamp-1 font-medium">{s.userAgent?.split(') ')[0] ?? 'Unknown device'}</div>
                <div className="text-xs text-ink-muted">
                  {s.ip} · since {formatDate(s.createdAt)}
                </div>
              </div>
              <button onClick={() => void revoke(s.id)} className="text-xs text-red-400 hover:underline">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

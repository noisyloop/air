import { useState } from 'react';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { useUi } from '../stores/ui';
import type { Page, UploadJob } from '../lib/types';
import { formatBytes, formatCount, formatDate } from '../lib/format';
import { BarChart } from '../components/BarChart';

const TABS = ['Overview', 'Uploads', 'Users', 'System', 'Audit log'] as const;
type Tab = (typeof TABS)[number];

interface Overview {
  totals: { users: number; tracks: number; artists: number };
  window: {
    days: number;
    plays: number;
    uniqueListeners: number;
    sessions: number;
    avgSessionMs: number;
    bandwidthBytes: number;
    searches: number;
    retentionRate: number | null;
  };
  uploadsByStatus: Record<string, number>;
  daily: { date: string; plays: number; listeners: number; newUsers: number }[];
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  _count: { playlists: number; history: number; uploadJobs: number };
}

interface Health {
  checks: Record<string, { ok: boolean; detail?: string }>;
  queues: Record<string, Record<string, number>>;
  uptime: number;
}

interface Audit {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  actor: { displayName: string; email: string } | null;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-surface-2 bg-surface-1 p-4">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('Overview');
  const showToast = useUi((s) => s.showToast);

  const overview = useFetch<Overview>(tab === 'Overview' ? '/analytics/overview?days=30' : null);
  const searches = useFetch<{ items: { query: string; count: number }[] }>(
    tab === 'Overview' ? '/analytics/top-searches?days=30' : null,
  );
  const uploads = useFetch<Page<UploadJob>>(tab === 'Uploads' ? '/admin/uploads?status=AWAITING_APPROVAL&limit=30' : null);
  const users = useFetch<Page<AdminUser>>(tab === 'Users' ? '/admin/users?limit=30' : null);
  const health = useFetch<Health>(tab === 'System' ? '/admin/health' : null);
  const storage = useFetch<Record<string, { count: number; bytes: number }>>(tab === 'System' ? '/admin/storage' : null);
  const audit = useFetch<Page<Audit>>(tab === 'Audit log' ? '/admin/audit-logs?limit=40' : null);

  const review = async (id: string, approve: boolean) => {
    const reason = approve ? undefined : (prompt('Rejection reason') ?? undefined);
    await api(`/admin/uploads/${id}/review`, { method: 'POST', body: { approve, reason } });
    showToast(approve ? 'Upload approved' : 'Upload rejected');
    uploads.reload();
  };

  const toggleActive = async (u: AdminUser) => {
    await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } });
    showToast(u.isActive ? 'User suspended' : 'User reactivated');
    users.reload();
  };

  const o = overview.data;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black">Admin dashboard</h1>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === t ? 'bg-ink text-surface-0' : 'bg-surface-1 hover:bg-surface-2'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && o && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Total users" value={formatCount(o.totals.users)} />
            <StatTile label="Tracks in catalog" value={formatCount(o.totals.tracks)} sub={`${o.totals.artists} artists`} />
            <StatTile label={`Plays (${o.window.days}d)`} value={formatCount(o.window.plays)} sub={`${o.window.uniqueListeners} unique listeners`} />
            <StatTile
              label="Retention"
              value={o.window.retentionRate != null ? `${Math.round(o.window.retentionRate * 100)}%` : '—'}
              sub="returning listeners"
            />
            <StatTile label="Sessions" value={formatCount(o.window.sessions)} sub={`avg ${Math.round(o.window.avgSessionMs / 60000)} min`} />
            <StatTile label="Bandwidth" value={formatBytes(o.window.bandwidthBytes)} sub="streamed this window" />
            <StatTile label="Searches" value={formatCount(o.window.searches)} />
            <StatTile
              label="Uploads pending"
              value={String(o.uploadsByStatus.AWAITING_APPROVAL ?? 0)}
              sub={`${o.uploadsByStatus.READY ?? 0} live`}
            />
          </div>

          <section className="rounded-xl border border-surface-2 bg-surface-1 p-4">
            <h2 className="mb-3 font-bold">Daily plays (30 days)</h2>
            <BarChart points={o.daily.map((d) => ({ label: formatDate(d.date), value: d.plays }))} />
            <p className="mt-1 text-xs text-ink-muted">Populated by the nightly rollup job — run POST /admin/rollup to backfill.</p>
          </section>
          <section className="rounded-xl border border-surface-2 bg-surface-1 p-4">
            <h2 className="mb-3 font-bold">Daily listeners (30 days)</h2>
            <BarChart points={o.daily.map((d) => ({ label: formatDate(d.date), value: d.listeners }))} />
          </section>

          <section className="rounded-xl border border-surface-2 bg-surface-1 p-4">
            <h2 className="mb-3 font-bold">Most searched (30 days)</h2>
            <div className="flex flex-wrap gap-2">
              {searches.data?.items.map((s) => (
                <span key={s.query} className="rounded-full bg-surface-2 px-3 py-1 text-sm">
                  {s.query} <span className="text-ink-muted">×{s.count}</span>
                </span>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'Uploads' && (
        <div className="space-y-2">
          {uploads.data?.items.length === 0 && <p className="text-ink-muted">No uploads awaiting approval.</p>}
          {uploads.data?.items.map((j) => (
            <div key={j.id} className="flex items-center justify-between rounded-lg bg-surface-1 px-4 py-3">
              <div>
                <div className="font-medium">
                  {j.metadata.title} <span className="text-ink-muted">— {j.metadata.albumTitle}</span>
                </div>
                <div className="text-xs text-ink-muted">
                  {j.artist?.name} · uploaded by {j.user?.displayName} · {formatDate(j.createdAt)}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => void review(j.id, true)} className="rounded-full bg-green-600 px-4 py-1.5 text-sm font-semibold text-white">
                  Approve
                </button>
                <button onClick={() => void review(j.id, false)} className="rounded-full bg-red-600/80 px-4 py-1.5 text-sm font-semibold text-white">
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Users' && (
        <div className="overflow-x-auto rounded-xl border border-surface-2">
          <table className="w-full text-sm">
            <thead className="bg-surface-1 text-left text-xs text-ink-muted uppercase">
              <tr>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Roles</th>
                <th className="px-4 py-2.5">Activity</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.data?.items.map((u) => (
                <tr key={u.id} className="border-t border-surface-2">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-ink-muted">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{u.roles.join(', ')}</td>
                  <td className="px-4 py-2.5 text-xs text-ink-muted">
                    {u._count.history} plays · {u._count.playlists} playlists
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold ${u.isActive ? 'text-green-500' : 'text-red-400'}`}>
                      {u.isActive ? '● Active' : '● Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => void toggleActive(u)} className="text-xs text-accent hover:underline">
                      {u.isActive ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'System' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {health.data &&
              Object.entries(health.data.checks).map(([name, c]) => (
                <div key={name} className="rounded-xl border border-surface-2 bg-surface-1 p-4">
                  <div className="text-xs text-ink-muted capitalize">{name}</div>
                  <div className={`mt-1 font-bold ${c.ok ? 'text-green-500' : 'text-red-400'}`}>
                    {c.ok ? '✓ Healthy' : '✗ Down'}
                  </div>
                  {c.detail && <div className="mt-1 line-clamp-2 text-[10px] text-ink-muted">{c.detail}</div>}
                </div>
              ))}
          </div>
          {health.data && (
            <section className="rounded-xl border border-surface-2 bg-surface-1 p-4">
              <h2 className="mb-2 font-bold">Queues</h2>
              <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                {Object.entries(health.data.queues).map(([name, counts]) => (
                  <div key={name}>
                    <div className="font-semibold capitalize">{name}</div>
                    <div className="text-xs text-ink-muted">
                      {counts.waiting ?? 0} waiting · {counts.active ?? 0} active · {counts.failed ?? 0} failed
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {storage.data && (
            <section className="rounded-xl border border-surface-2 bg-surface-1 p-4">
              <h2 className="mb-2 font-bold">Storage utilization</h2>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {Object.entries(storage.data).map(([name, s]) => (
                  <div key={name}>
                    <div className="font-semibold capitalize">{name.replace(/([A-Z])/g, ' $1')}</div>
                    <div className="text-xs text-ink-muted">
                      {s.count} objects · {formatBytes(s.bytes)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === 'Audit log' && (
        <div className="space-y-1.5">
          {audit.data?.items.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg bg-surface-1 px-4 py-2 text-sm">
              <code className="rounded bg-surface-2 px-2 py-0.5 text-xs">{a.action}</code>
              <span className="text-ink-muted">
                {a.actor ? a.actor.displayName : 'system'}
                {a.targetType && ` → ${a.targetType} ${a.targetId?.slice(0, 8)}`}
              </span>
              <span className="ml-auto text-xs text-ink-muted">{formatDate(a.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

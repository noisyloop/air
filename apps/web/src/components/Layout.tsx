import { useEffect } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../stores/auth';
import { usePlayer } from '../stores/player';
import { useUi } from '../stores/ui';
import { useFetch } from '../hooks/useFetch';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { Playlist } from '../lib/types';
import { SearchBox } from './SearchBox';
import { NotificationsBell } from './NotificationsBell';
import { PlayerBar } from './PlayerBar';
import { FullscreenPlayer } from './FullscreenPlayer';
import { ChartIcon, HomeIcon, LibraryIcon, MoonIcon, PinIcon, SearchIcon, SunIcon, UploadIcon } from './Icons';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:text-ink'
  }`;

function Sidebar() {
  const user = useAuth((s) => s.user);
  const hasPermission = useAuth((s) => s.hasPermission);
  const { data } = useFetch<{ items: (Playlist & { pinned: boolean })[]; folders: { id: string; name: string; playlists: Playlist[] }[] }>(
    user ? '/playlists' : null,
  );

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-surface-2 bg-surface-0 p-3 md:flex">
      <Link to="/" className="mb-4 flex items-center gap-2 px-3 pt-1 text-xl font-black tracking-tight">
        <span className="text-accent">◉</span> air
      </Link>
      <NavLink to="/" end className={navClass}>
        <HomeIcon size={18} /> Home
      </NavLink>
      <NavLink to="/search" className={navClass}>
        <SearchIcon size={18} /> Search
      </NavLink>
      <NavLink to="/library" className={navClass}>
        <LibraryIcon size={18} /> Library
      </NavLink>
      {hasPermission('track:upload') && (
        <NavLink to="/upload" className={navClass}>
          <UploadIcon size={18} /> Upload
        </NavLink>
      )}
      {hasPermission('admin:analytics') && (
        <NavLink to="/dashboard" className={navClass}>
          <ChartIcon size={18} /> Dashboard
        </NavLink>
      )}

      {user && (
        <>
          <div className="mt-5 mb-1 px-3 text-xs font-semibold tracking-wider text-ink-muted uppercase">Playlists</div>
          {data?.items
            .filter((p) => p.pinned)
            .map((p) => (
              <NavLink key={p.id} to={`/playlist/${p.id}`} className={navClass}>
                <PinIcon size={14} filled /> <span className="line-clamp-1">{p.title}</span>
              </NavLink>
            ))}
          {data?.folders.map((f) => (
            <div key={f.id} className="mt-1">
              <div className="px-3 py-1 text-xs font-semibold text-ink-muted">📁 {f.name}</div>
              {f.playlists.map((p) => (
                <NavLink key={p.id} to={`/playlist/${p.id}`} className={navClass}>
                  <span className="line-clamp-1 pl-4">{p.title}</span>
                </NavLink>
              ))}
            </div>
          ))}
          {data?.items
            .filter((p) => !p.pinned)
            .slice(0, 12)
            .map((p) => (
              <NavLink key={p.id} to={`/playlist/${p.id}`} className={navClass}>
                <span className="line-clamp-1">{p.title}</span>
              </NavLink>
            ))}
        </>
      )}
    </aside>
  );
}

function Topbar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useUi();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-surface-2 bg-surface-0/90 px-6 py-3 backdrop-blur">
      <SearchBox />
      <div className="ml-auto flex items-center gap-4">
        <button onClick={toggleTheme} aria-label="Toggle theme" className="text-ink-muted hover:text-ink">
          {theme === 'dark' ? <SunIcon size={20} /> : <MoonIcon size={20} />}
        </button>
        {user ? (
          <>
            <NotificationsBell />
            <div className="group relative">
              <button className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
                {user.displayName.charAt(0).toUpperCase()}
              </button>
              <div className="invisible absolute top-9 right-0 w-44 rounded-xl border border-surface-2 bg-surface-1 py-1 opacity-0 shadow-2xl transition-all group-hover:visible group-hover:opacity-100">
                <Link to="/profile" className="block px-4 py-2 text-sm hover:bg-surface-2">
                  Profile
                </Link>
                <Link to="/settings" className="block px-4 py-2 text-sm hover:bg-surface-2">
                  Settings
                </Link>
                <button
                  onClick={() => void logout().then(() => navigate('/login'))}
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-surface-2"
                >
                  Log out
                </button>
              </div>
            </div>
          </>
        ) : (
          <Link to="/login" className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white">
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}

function Toast() {
  const toast = useUi((s) => s.toast);
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-2 text-sm font-medium text-surface-0 shadow-2xl"
        >
          {toast}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AppLayout() {
  useKeyboardShortcuts();
  const user = useAuth((s) => s.user);
  const resumeFromServer = usePlayer((s) => s.resumeFromServer);
  const hasQueue = usePlayer((s) => s.queue.length > 0);

  // Restore last playback position once after login.
  useEffect(() => {
    if (user && !hasQueue) void resumeFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-6 py-6 pb-28">
          <Outlet />
        </main>
      </div>
      <PlayerBar />
      <FullscreenPlayer />
      <Toast />
    </div>
  );
}

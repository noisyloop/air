import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './stores/auth';
import { AppLayout } from './components/Layout';
import { Login, Register } from './pages/Auth';
import Home from './pages/Home';
import NotFound from './pages/NotFound';

// Heavier pages are lazy-loaded route chunks.
const Search = lazy(() => import('./pages/Search'));
const Library = lazy(() => import('./pages/Library'));
const Album = lazy(() => import('./pages/Album'));
const Artist = lazy(() => import('./pages/Artist'));
const Playlist = lazy(() => import('./pages/Playlist'));
const Queue = lazy(() => import('./pages/Queue'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
const Upload = lazy(() => import('./pages/Upload'));
const Dashboard = lazy(() => import('./pages/Dashboard'));

function PageFallback() {
  return (
    <div className="space-y-4 p-2">
      <div className="skeleton h-9 w-56" />
      <div className="skeleton h-40 w-full" />
    </div>
  );
}

function RequireAuth() {
  const { user, ready } = useAuth();
  if (!ready) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequirePermission({ perm }: { perm: string }) {
  const { user, ready, hasPermission } = useAuth();
  if (!ready) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasPermission(perm)) return <NotFound />;
  return <Outlet />;
}

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<AppLayout />}>
          <Route
            path="/"
            element={
              <Suspense fallback={<PageFallback />}>
                <Home />
              </Suspense>
            }
          />
          <Route
            element={
              <Suspense fallback={<PageFallback />}>
                <Outlet />
              </Suspense>
            }
          >
            <Route path="/search" element={<Search />} />
            <Route path="/album/:id" element={<Album />} />
            <Route path="/artist/:id" element={<Artist />} />
            <Route path="/playlist/:id" element={<Playlist />} />
            <Route element={<RequireAuth />}>
              <Route path="/library" element={<Library />} />
              <Route path="/queue" element={<Queue />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route element={<RequirePermission perm="track:upload" />}>
              <Route path="/upload" element={<Upload />} />
            </Route>
            <Route element={<RequirePermission perm="admin:analytics" />}>
              <Route path="/dashboard" element={<Dashboard />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

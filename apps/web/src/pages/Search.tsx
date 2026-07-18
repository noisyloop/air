import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Track } from '../lib/types';
import { useAuth } from '../stores/auth';
import { useFetch } from '../hooks/useFetch';
import { TrackList } from '../components/TrackList';
import { Section } from '../components/Cards';
import { Artwork } from '../components/Artwork';
import { TrackListSkeleton } from '../components/Skeletons';

interface Hit {
  id: string;
  title?: string;
  name?: string;
  slug?: string;
  artistName?: string;
  artUrl?: string | null;
  imageUrl?: string | null;
  ownerName?: string;
  durationMs?: number;
  explicit?: boolean;
}

interface SearchResults {
  tracks: Hit[];
  albums: Hit[];
  artists: Hit[];
  playlists: Hit[];
  genres: Hit[];
}

function hitToTrack(h: Hit): Track {
  return {
    id: h.id,
    title: h.title ?? '',
    slug: h.slug ?? h.id,
    durationMs: h.durationMs ?? 0,
    trackNumber: 1,
    explicit: h.explicit ?? false,
    popularity: 0,
    artist: { id: '', name: h.artistName ?? '', slug: '' },
    album: { id: '', title: '', slug: '', artUrl: h.artUrl ?? null },
    genres: [],
  };
}

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const user = useAuth((s) => s.user);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: recent, reload: reloadRecent } = useFetch<{ items: string[] }>(user ? '/search/recent' : null);
  const { data: trending } = useFetch<{ items: { query: string; count: number }[] }>('/search/trending');
  const { data: genres } = useFetch<{ items: { id: string; name: string; slug: string; trackCount: number }[] }>('/genres');

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    void api<SearchResults>(`/search?q=${encodeURIComponent(q)}&limit=12`)
      .then((r) => {
        setResults(r);
        reloadRecent();
      })
      .finally(() => setLoading(false));
  }, [q, reloadRecent]);

  if (!q.trim()) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-black">Search</h1>
        {(recent?.items.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-bold">Recent searches</h2>
            <div className="flex flex-wrap gap-2">
              {recent!.items.map((r) => (
                <Link key={r} to={`/search?q=${encodeURIComponent(r)}`} className="rounded-full bg-surface-1 px-4 py-1.5 text-sm hover:bg-surface-2">
                  {r}
                </Link>
              ))}
            </div>
          </section>
        )}
        {(trending?.items.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-bold">Trending searches</h2>
            <div className="flex flex-wrap gap-2">
              {trending!.items.map((t) => (
                <Link key={t.query} to={`/search?q=${encodeURIComponent(t.query)}`} className="rounded-full bg-surface-1 px-4 py-1.5 text-sm hover:bg-surface-2">
                  🔥 {t.query}
                </Link>
              ))}
            </div>
          </section>
        )}
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Browse genres</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {genres?.items.map((g, i) => (
              <Link
                key={g.id}
                to={`/search?q=${encodeURIComponent(g.name)}`}
                className="rounded-xl p-5 font-bold text-white shadow"
                style={{ background: `linear-gradient(135deg, hsl(${(i * 47) % 360},60%,45%), hsl(${(i * 47 + 60) % 360},60%,30%))` }}
              >
                {g.name}
                <div className="text-xs font-normal opacity-80">{g.trackCount} tracks</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-black">Results for “{q}”</h1>
      {loading && <TrackListSkeleton />}
      {results && (
        <>
          {results.tracks.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-bold">Songs</h2>
              <TrackList tracks={results.tracks.map(hitToTrack)} showArt contextLabel="Search" />
            </section>
          )}
          {results.artists.length > 0 && (
            <Section title="Artists">
              {results.artists.map((a) => (
                <Link key={a.id} to={`/artist/${a.slug ?? a.id}`} className="w-36 shrink-0 space-y-2 rounded-lg bg-surface-1 p-3 hover:bg-surface-2">
                  <Artwork src={a.imageUrl} className="aspect-square w-full" rounded="rounded-full" />
                  <div className="line-clamp-1 text-sm font-semibold">{a.name}</div>
                </Link>
              ))}
            </Section>
          )}
          {results.albums.length > 0 && (
            <Section title="Albums">
              {results.albums.map((a) => (
                <Link key={a.id} to={`/album/${a.slug ?? a.id}`} className="w-36 shrink-0 space-y-2 rounded-lg bg-surface-1 p-3 hover:bg-surface-2">
                  <Artwork src={a.artUrl} className="aspect-square w-full" />
                  <div className="line-clamp-1 text-sm font-semibold">{a.title}</div>
                  <div className="line-clamp-1 text-xs text-ink-muted">{a.artistName}</div>
                </Link>
              ))}
            </Section>
          )}
          {results.playlists.length > 0 && (
            <Section title="Playlists">
              {results.playlists.map((p) => (
                <Link key={p.id} to={`/playlist/${p.id}`} className="w-36 shrink-0 space-y-2 rounded-lg bg-surface-1 p-3 hover:bg-surface-2">
                  <Artwork src={null} className="aspect-square w-full" />
                  <div className="line-clamp-1 text-sm font-semibold">{p.title}</div>
                  <div className="line-clamp-1 text-xs text-ink-muted">By {p.ownerName}</div>
                </Link>
              ))}
            </Section>
          )}
          {!results.tracks.length && !results.artists.length && !results.albums.length && !results.playlists.length && (
            <p className="text-ink-muted">Nothing found. The search index may still be building — try `POST /admin/reindex`.</p>
          )}
        </>
      )}
    </div>
  );
}

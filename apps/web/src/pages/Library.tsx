import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import type { Album, Artist, Page, Playlist, Track } from '../lib/types';
import { TrackList } from '../components/TrackList';
import { AlbumCard, ArtistCard, PlaylistCard } from '../components/Cards';
import { TrackListSkeleton } from '../components/Skeletons';
import { PlusIcon } from '../components/Icons';
import { useUi } from '../stores/ui';

const TABS = ['Liked songs', 'Albums', 'Artists', 'Playlists', 'Recently played', 'Recently added'] as const;
type Tab = (typeof TABS)[number];

export default function Library() {
  const [tab, setTab] = useState<Tab>('Liked songs');
  const showToast = useUi((s) => s.showToast);

  const likedTracks = useFetch<Page<Track & { likedAt: string }>>(tab === 'Liked songs' ? '/favorites?type=TRACK&limit=100' : null);
  const likedAlbums = useFetch<Page<Album>>(tab === 'Albums' ? '/favorites?type=ALBUM&limit=50' : null);
  const likedArtists = useFetch<Page<Artist>>(tab === 'Artists' ? '/favorites?type=ARTIST&limit=50' : null);
  const playlists = useFetch<{ items: Playlist[]; folders: { id: string; name: string; playlists: Playlist[] }[] }>(
    tab === 'Playlists' ? '/playlists' : null,
  );
  const history = useFetch<Page<Track & { playedAt: string }>>(tab === 'Recently played' ? '/history?limit=50' : null);
  const recentAdded = useFetch<Page<Track>>(tab === 'Recently added' ? '/tracks?sort=newest&limit=50' : null);

  const createPlaylist = async () => {
    const title = prompt('Playlist name');
    if (!title) return;
    await api('/playlists', { method: 'POST', body: { title, isPublic: false } });
    showToast('Playlist created');
    playlists.reload();
  };

  const likedList = likedTracks.data?.items.map((t) => ({ ...t, liked: true }));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black">Your Library</h1>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? 'bg-ink text-surface-0' : 'bg-surface-1 hover:bg-surface-2'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Liked songs' &&
        (likedTracks.loading ? (
          <TrackListSkeleton />
        ) : (
          <TrackList
            tracks={likedList ?? []}
            showArt
            showAlbum
            contextLabel="Liked songs"
            onLikeChange={() => likedTracks.reload()}
          />
        ))}

      {tab === 'Albums' && (
        <div className="flex flex-wrap gap-4">
          {likedAlbums.data?.items.map((a) => <AlbumCard key={a.id} album={a} />)}
          {likedAlbums.data?.items.length === 0 && <p className="text-ink-muted">Like an album to see it here.</p>}
        </div>
      )}

      {tab === 'Artists' && (
        <div className="flex flex-wrap gap-4">
          {likedArtists.data?.items.map((a) => <ArtistCard key={a.id} artist={a} />)}
          {likedArtists.data?.items.length === 0 && <p className="text-ink-muted">Like an artist to see them here.</p>}
        </div>
      )}

      {tab === 'Playlists' && (
        <div className="space-y-6">
          <button onClick={createPlaylist} className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white">
            <PlusIcon size={16} /> New playlist
          </button>
          {playlists.data?.folders.map((f) => (
            <section key={f.id} className="space-y-2">
              <h2 className="font-bold">📁 {f.name}</h2>
              <div className="flex flex-wrap gap-4">
                {f.playlists.map((p) => (
                  <PlaylistCard key={p.id} playlist={p} />
                ))}
              </div>
            </section>
          ))}
          <div className="flex flex-wrap gap-4">
            {playlists.data?.items.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
          </div>
        </div>
      )}

      {tab === 'Recently played' &&
        (history.loading ? <TrackListSkeleton /> : <TrackList tracks={history.data?.items ?? []} showArt showAlbum contextLabel="Recently played" />)}

      {tab === 'Recently added' &&
        (recentAdded.loading ? (
          <TrackListSkeleton />
        ) : (
          <TrackList tracks={recentAdded.data?.items ?? []} showArt showAlbum contextLabel="Recently added" />
        ))}

      <p className="text-xs text-ink-muted">
        Tip: open any <Link to="/search" className="underline">search</Link> result's album or artist to add more to your library.
      </p>
    </div>
  );
}

import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import type { Artist } from '../lib/types';
import { formatCount } from '../lib/format';
import { usePlayer } from '../stores/player';
import { Artwork } from '../components/Artwork';
import { TrackList } from '../components/TrackList';
import { AlbumCard, ArtistCard, Section } from '../components/Cards';
import { HeaderSkeleton, TrackListSkeleton } from '../components/Skeletons';
import { CheckIcon, PlayIcon } from '../components/Icons';

export default function ArtistPage() {
  const { id } = useParams();
  const { data: artist, loading, setData } = useFetch<Artist>(id ? `/artists/${id}` : null);
  const { data: related } = useFetch<{ items: Artist[] }>(id ? `/artists/${id}/related` : null);
  const playTracks = usePlayer((s) => s.playTracks);

  if (loading || !artist) {
    return (
      <div className="space-y-8">
        <HeaderSkeleton />
        <TrackListSkeleton />
      </div>
    );
  }

  const follow = async () => {
    const res = await api<{ following: boolean }>(`/artists/${artist.id}/follow`, { method: 'POST' });
    setData((prev) =>
      prev
        ? { ...prev, isFollowing: res.following, followerCount: (prev.followerCount ?? 0) + (res.following ? 1 : -1) }
        : prev,
    );
  };

  return (
    <div className="space-y-10">
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
        <Artwork src={artist.imageUrl} alt={artist.name} className="size-48 shadow-2xl" rounded="rounded-full" />
        <div className="space-y-2">
          {artist.verified && (
            <div className="flex items-center gap-1 text-xs font-semibold text-accent">
              <CheckIcon size={14} /> Verified artist
            </div>
          )}
          <h1 className="text-5xl font-black">{artist.name}</h1>
          <div className="text-sm text-ink-muted">
            {formatCount(artist.monthlyListeners)} monthly listeners · {formatCount(artist.followerCount ?? 0)} followers
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void playTracks(artist.popularTracks ?? [], 0, artist.name)}
              className="flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 font-semibold text-white transition-transform hover:scale-105"
            >
              <PlayIcon size={18} /> Play
            </button>
            <button
              onClick={follow}
              className={`rounded-full border px-5 py-2 text-sm font-semibold ${
                artist.isFollowing ? 'border-accent text-accent' : 'border-surface-2'
              }`}
            >
              {artist.isFollowing ? 'Following' : 'Follow'}
            </button>
          </div>
        </div>
      </motion.header>

      <section className="space-y-2">
        <h2 className="text-xl font-bold">Popular</h2>
        <TrackList
          tracks={artist.popularTracks ?? []}
          showArt
          contextLabel={artist.name}
          onLikeChange={(trackId, liked) =>
            setData((prev) =>
              prev
                ? { ...prev, popularTracks: prev.popularTracks?.map((t) => (t.id === trackId ? { ...t, liked } : t)) }
                : prev,
            )
          }
        />
      </section>

      {(artist.albums?.length ?? 0) > 0 && (
        <Section title="Albums">
          {artist.albums!.map((a) => (
            <AlbumCard key={a.id} album={{ ...a, artist: { id: artist.id, name: artist.name, slug: artist.slug } }} />
          ))}
        </Section>
      )}
      {(artist.singles?.length ?? 0) > 0 && (
        <Section title="Singles & EPs">
          {artist.singles!.map((a) => (
            <AlbumCard key={a.id} album={{ ...a, artist: { id: artist.id, name: artist.name, slug: artist.slug } }} />
          ))}
        </Section>
      )}

      {artist.bio && (
        <section className="max-w-2xl space-y-2">
          <h2 className="text-xl font-bold">About</h2>
          <p className="text-sm leading-relaxed text-ink-muted">{artist.bio}</p>
          {artist.genres.length > 0 && (
            <div className="flex gap-2 pt-1">
              {artist.genres.map((g) => (
                <span key={g.id} className="rounded-full bg-surface-1 px-3 py-1 text-xs">
                  {g.name}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {(related?.items.length ?? 0) > 0 && (
        <Section title="Fans also like">
          {related!.items.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </Section>
      )}
    </div>
  );
}

import { motion } from 'framer-motion';
import { useFetch } from '../hooks/useFetch';
import type { Album, HomeSection, Track } from '../lib/types';
import { useAuth } from '../stores/auth';
import { AlbumCard, Section, TrackCard } from '../components/Cards';
import { CardRowSkeleton } from '../components/Skeletons';

export default function Home() {
  const user = useAuth((s) => s.user);
  const { data, loading } = useFetch<{ sections: HomeSection[] }>('/recommendations/home');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-8">
      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-black">
        {greeting}
        {user ? `, ${user.displayName.split(' ')[0]}` : ''}
      </motion.h1>

      {loading && (
        <>
          <CardRowSkeleton />
          <CardRowSkeleton />
        </>
      )}

      {data?.sections.map((section) => (
        <Section key={section.key} title={section.title}>
          {section.kind === 'album'
            ? (section.items as Album[]).map((album) => <AlbumCard key={album.id} album={album} />)
            : (section.items as Track[]).map((track) => (
                <TrackCard key={track.id} track={track} tracks={section.items as Track[]} />
              ))}
        </Section>
      ))}
    </div>
  );
}

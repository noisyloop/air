import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { useFetch } from '../hooks/useFetch';

interface Me {
  id: string;
  email: string;
  displayName: string;
  bio: string | null;
  createdAt: string;
  artistProfile: { id: string; name: string; slug: string } | null;
  _count: { followers: number; following: number; playlists: number };
}

export default function Profile() {
  const user = useAuth((s) => s.user);
  const showToast = useUi((s) => s.showToast);
  const { data: me, reload } = useFetch<Me>(user ? '/me' : null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');

  if (!me) return <div className="skeleton h-40 w-full max-w-xl" />;

  const save = async () => {
    await api('/me', { method: 'PATCH', body: { displayName: displayName || me.displayName, bio: bio || null } });
    showToast('Profile updated');
    setEditing(false);
    reload();
  };

  return (
    <div className="max-w-xl space-y-8">
      <header className="flex items-center gap-5">
        <div className="flex size-24 items-center justify-center rounded-full bg-accent text-4xl font-black text-white">
          {me.displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="text-xs font-semibold tracking-wider text-ink-muted uppercase">Profile</div>
          <h1 className="text-3xl font-black">{me.displayName}</h1>
          <div className="text-sm text-ink-muted">
            {me._count.playlists} playlists · {me._count.followers} followers · {me._count.following} following
          </div>
        </div>
      </header>

      {me.artistProfile && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
          🎤 You manage the artist profile{' '}
          <a href={`/artist/${me.artistProfile.slug}`} className="font-semibold underline">
            {me.artistProfile.name}
          </a>
        </div>
      )}

      {me.bio && !editing && <p className="text-sm text-ink-muted">{me.bio}</p>}

      {editing ? (
        <div className="space-y-3">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={me.displayName}
            className="w-full rounded-lg bg-surface-1 px-4 py-2.5 text-sm outline-none ring-accent/50 focus:ring-2"
          />
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={me.bio ?? 'Tell people about yourself'}
            rows={3}
            className="w-full rounded-lg bg-surface-1 px-4 py-2.5 text-sm outline-none ring-accent/50 focus:ring-2"
          />
          <div className="flex gap-2">
            <button onClick={save} className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="rounded-full border border-surface-2 px-5 py-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setDisplayName(me.displayName);
            setBio(me.bio ?? '');
            setEditing(true);
          }}
          className="rounded-full border border-surface-2 px-5 py-2 text-sm font-semibold"
        >
          Edit profile
        </button>
      )}
    </div>
  );
}

import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { useFetch } from '../hooks/useFetch';
import type { Page, UploadJob } from '../lib/types';
import { formatDate } from '../lib/format';

const STATUS_COLORS: Record<string, string> = {
  READY: 'text-green-500',
  FAILED: 'text-red-400',
  REJECTED: 'text-red-400',
  AWAITING_APPROVAL: 'text-amber-400',
};

export default function Upload() {
  const user = useAuth((s) => s.user);
  const showToast = useUi((s) => s.showToast);
  const { data: jobs, reload } = useFetch<Page<UploadJob>>('/uploads?limit=20');
  const { data: genres } = useFetch<{ items: { name: string; slug: string }[] }>('/genres');

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [albumTitle, setAlbumTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const artistId = user?.artistProfile?.id;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !artistId || !attested) return;
    setBusy(true);
    try {
      setProgress('Requesting signed upload URL…');
      const { uploadJobId, signedUrl } = await api<{ uploadJobId: string; signedUrl: string }>('/uploads', {
        method: 'POST',
        body: {
          artistId,
          filename: file.name,
          mimeType: file.type || 'audio/wav',
          sizeBytes: file.size,
          metadata: {
            title,
            albumTitle,
            albumType: 'SINGLE',
            genres: genre ? [genre] : [],
            rightsAttestation: true,
          },
        },
      });
      setProgress('Uploading audio to storage…');
      const put = await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'audio/wav' } });
      if (!put.ok) throw new Error(`Storage upload failed (${put.status})`);
      setProgress('Queuing processing…');
      await api(`/uploads/${uploadJobId}/complete`, { method: 'POST' });
      showToast('Upload queued — processing will start shortly');
      setFile(null);
      setTitle('');
      setAlbumTitle('');
      reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (!artistId) {
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="text-3xl font-black">Upload</h1>
        <p className="text-ink-muted">
          Uploading requires an artist profile. Ask an admin to link one to your account from the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-10">
      <h1 className="text-3xl font-black">Upload music</h1>

      <form onSubmit={submit} className="space-y-4 rounded-xl border border-surface-2 bg-surface-1 p-6">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Audio file (WAV / FLAC / MP3 / AAC / OGG, ≤200 MB)</span>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full rounded-lg bg-surface-2 text-sm file:mr-3 file:rounded-l-lg file:border-0 file:bg-accent file:px-4 file:py-2.5 file:text-white"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Track title"
            required
            className="rounded-lg bg-surface-2 px-4 py-2.5 text-sm outline-none ring-accent/50 focus:ring-2"
          />
          <input
            value={albumTitle}
            onChange={(e) => setAlbumTitle(e.target.value)}
            placeholder="Album / single title"
            required
            className="rounded-lg bg-surface-2 px-4 py-2.5 text-sm outline-none ring-accent/50 focus:ring-2"
          />
        </div>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          className="w-full rounded-lg bg-surface-2 px-4 py-2.5 text-sm outline-none"
        >
          <option value="">Genre (optional)</option>
          {genres?.items.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>
        <label className="flex items-start gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 accent-accent" />
          I own or hold distribution rights for this audio, and it contains no third-party content I'm not licensed to
          distribute.
        </label>
        <button
          disabled={!file || !title || !albumTitle || !attested || busy}
          className="rounded-full bg-accent px-6 py-2.5 font-semibold text-white disabled:opacity-40"
        >
          {busy ? (progress ?? 'Uploading…') : 'Upload'}
        </button>
        <p className="text-xs text-ink-muted">
          After upload the pipeline extracts metadata, analyzes loudness, renders the waveform, and encodes streaming
          bitrates. Non-admin uploads are reviewed before going live.
        </p>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Your uploads</h2>
        <ul className="space-y-2">
          {jobs?.items.map((j) => (
            <li key={j.id} className="flex items-center justify-between rounded-lg bg-surface-1 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{j.metadata.title ?? j.originalFilename}</div>
                <div className="text-xs text-ink-muted">
                  {formatDate(j.createdAt)}
                  {j.error && <span className="text-red-400"> — {j.error}</span>}
                </div>
              </div>
              <span className={`text-xs font-semibold ${STATUS_COLORS[j.status] ?? 'text-ink-muted'}`}>
                {j.status.replaceAll('_', ' ')}
              </span>
            </li>
          ))}
          {jobs?.items.length === 0 && <li className="text-sm text-ink-muted">No uploads yet.</li>}
        </ul>
      </section>
    </div>
  );
}

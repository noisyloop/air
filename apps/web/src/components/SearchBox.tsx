import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api';
import { Artwork } from './Artwork';
import { SearchIcon } from './Icons';

interface Suggestion {
  type: 'track' | 'album' | 'artist';
  id: string;
  label: string;
  sub?: string;
  imageUrl?: string | null;
}

/** Topbar search with debounced autocomplete. */
export function SearchBox() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounce.current = setTimeout(() => {
      void api<{ suggestions: Suggestion[] }>(`/search/suggest?q=${encodeURIComponent(q.trim())}`)
        .then((res) => setSuggestions(res.suggestions.slice(0, 8)))
        .catch(() => setSuggestions([]));
    }, 180);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (s: Suggestion) => {
    setOpen(false);
    setQ('');
    navigate(s.type === 'track' ? `/search?q=${encodeURIComponent(s.label)}` : `/${s.type}/${s.id}`);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) {
            setOpen(false);
            navigate(`/search?q=${encodeURIComponent(q.trim())}`);
          }
        }}
      >
        <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
        <input
          id="search-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search songs, artists, albums…"
          className="w-full rounded-full bg-surface-1 py-2 pr-4 pl-9 text-sm outline-none ring-accent/50 placeholder:text-ink-muted focus:ring-2"
        />
      </form>
      <AnimatePresence>
        {open && suggestions.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-11 right-0 left-0 z-50 overflow-hidden rounded-xl border border-surface-2 bg-surface-1 py-1 shadow-2xl"
          >
            {suggestions.map((s) => (
              <li key={`${s.type}:${s.id}`}>
                <button
                  onClick={() => go(s)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
                >
                  <Artwork src={s.imageUrl} className="size-8" rounded={s.type === 'artist' ? 'rounded-full' : 'rounded'} />
                  <span className="min-w-0">
                    <span className="line-clamp-1 block text-sm">{s.label}</span>
                    <span className="line-clamp-1 block text-xs text-ink-muted capitalize">{s.sub ?? s.type}</span>
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

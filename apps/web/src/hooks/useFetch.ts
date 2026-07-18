import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/** Minimal data hook: fetch on mount / when path changes, expose reload(). */
export function useFetch<T>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
} {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    if (!path) return;
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((res) => {
        if (generation.current === gen) setDataState(res);
      })
      .catch((e: Error) => {
        if (generation.current === gen) setError(e.message);
      })
      .finally(() => {
        if (generation.current === gen) setLoading(false);
      });
  }, [path]);

  useEffect(() => {
    setDataState(null);
    load();
  }, [load]);

  const setData = useCallback((updater: (prev: T | null) => T | null) => {
    setDataState(updater);
  }, []);

  return { data, loading, error, reload: load, setData };
}

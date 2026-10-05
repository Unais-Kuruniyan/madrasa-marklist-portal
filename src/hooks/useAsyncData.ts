import { useCallback, useEffect, useRef, useState } from 'react';
import { handleError } from '../lib/supabase/errors';

interface AsyncState<T> {
  data: T | undefined;
  /** True only for the very first load (no data yet). */
  loading: boolean;
  /** True while re-fetching with existing data on screen. */
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Minimal data-loading hook: loads once on mount / when `deps` change,
 * and exposes `reload()` for refreshing after mutations.
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async (isRefresh: boolean) => {
    const id = ++requestId.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (id === requestId.current) setData(result);
    } catch (err) {
      if (id === requestId.current) setError(handleError(err, 'Could not load data. Please try again.'));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    setData(undefined);
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run(data !== undefined), [run, data]);

  return { data, loading, refreshing, error, reload };
}

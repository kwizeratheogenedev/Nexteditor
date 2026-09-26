import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';

// Loads `path` with `query`, reloading whenever either changes.
export function useApi(path, query) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(query || {});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(path, { query: JSON.parse(key) }));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [path, key]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

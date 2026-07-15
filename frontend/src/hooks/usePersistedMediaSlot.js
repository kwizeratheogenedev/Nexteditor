import { useState, useEffect, useCallback } from 'react';
import { persistFile, getPersistedFile, removePersistedFile } from '../utils/indexedDB';

const SLOT_PREFIX = 'nexeditor_slot_';

export function usePersistedMediaSlot(slotId, initialValue) {
  const storageKey = `${SLOT_PREFIX}${slotId}`;
  const fileKey = `${storageKey}_file`;

  const [state, setState] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...initialValue,
          ...parsed,
          file: null,
        };
      }
    } catch (error) {
      console.warn(`Error reading persisted slot "${storageKey}":`, error);
    }
    return initialValue;
  });

  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const stored = localStorage.getItem(storageKey);
        if (!stored) {
          if (!cancelled) setRestored(true);
          return;
        }

        const parsed = JSON.parse(stored);
        if (!parsed.fileName && !parsed.filePath) {
          if (!cancelled) setRestored(true);
          return;
        }

        let file = null;

        if (parsed.sourceMode === 'device' && parsed.fileName) {
          file = await getPersistedFile(fileKey);
        }

        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            ...parsed,
            file: file || null,
          }));
          setRestored(true);
        }
      } catch (error) {
        console.warn(`Error restoring slot "${storageKey}":`, error);
        if (!cancelled) setRestored(true);
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, [storageKey, fileKey]);

  const persist = useCallback(async (newState) => {
    try {
      const { file, ...serializable } = newState;
      localStorage.setItem(storageKey, JSON.stringify(serializable));

      if (file instanceof File) {
        await persistFile(fileKey, file);
      } else if (!file) {
        await removePersistedFile(fileKey);
      }
    } catch (error) {
      console.warn(`Error persisting slot "${storageKey}":`, error);
    }
  }, [storageKey, fileKey]);

  const updateState = useCallback((updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      persist(next);
      return next;
    });
  }, [persist]);

  const clear = useCallback(() => {
    setState(initialValue);
    localStorage.removeItem(storageKey);
    removePersistedFile(fileKey);
  }, [storageKey, fileKey, initialValue]);

  return [state, updateState, clear, restored];
}

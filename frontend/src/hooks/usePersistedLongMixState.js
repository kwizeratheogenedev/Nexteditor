import { useState, useEffect, useRef } from 'react';
import { persistFile, getPersistedFile, removePersistedFile } from '../utils/indexedDB';
import { DEFAULT_LONGMIX_SETTINGS } from '../timeline/longMix';

const STORAGE_PREFIX = 'nexeditor_longmix_';
const SONGS_KEY = `${STORAGE_PREFIX}songs`;
const SCENES_KEY = `${STORAGE_PREFIX}scenes`;
const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;
const JOB_KEY = `${STORAGE_PREFIX}job`;

function fileKeyFor(kind, id) {
  return `${STORAGE_PREFIX}${kind}_${id}`;
}

// Reattaches each entry's real File (from IndexedDB, same store
// usePersistedEditorState/usePersistedMontageState already use) and mints
// it a fresh blob: URL - the one saved before the reload is already dead,
// since a blob URL only lives as long as the document that created it. An
// entry whose file never made it into IndexedDB (e.g. this ran before that
// write's debounce fired) is dropped rather than shown as a dead row.
async function restoreEntries(key, kind) {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const metas = JSON.parse(stored);
    const entries = await Promise.all(metas.map(async (meta) => {
      const file = await getPersistedFile(fileKeyFor(kind, meta.id));
      if (!file) return null;
      return { ...meta, file, url: URL.createObjectURL(file) };
    }));
    return entries.filter(Boolean);
  } catch (error) {
    console.warn(`Error restoring LongMix ${kind}:`, error);
    return [];
  }
}

async function persistEntries(key, kind, entries, previousIdsRef) {
  try {
    // Picked explicitly rather than destructuring-and-omitting `file`/`url`
    // - see createLongMixEntry in timeline/longMix.js for this entry shape.
    const meta = entries.map(({ id, sourceId, kind, duration, title }) => ({ id, sourceId, kind, duration, title }));
    localStorage.setItem(key, JSON.stringify(meta));
    await Promise.all(entries.map((entry) => (
      entry.file instanceof File ? persistFile(fileKeyFor(kind, entry.id), entry.file) : null
    )));
    // Drop IndexedDB entries for anything removed (or renamed away from)
    // since the last save, so deleting a song/scene doesn't leak its file
    // in IndexedDB forever.
    const currentIds = new Set(entries.map((entry) => entry.id));
    const stale = [...previousIdsRef.current].filter((id) => !currentIds.has(id));
    await Promise.all(stale.map((id) => removePersistedFile(fileKeyFor(kind, id))));
    previousIdsRef.current = currentIds;
  } catch (error) {
    console.warn(`Error persisting LongMix ${kind}:`, error);
  }
}

// Keeps LongMix Studio's own wizard state (songs, scenes, settings) and the
// state of whatever render is/was in flight (jobId, building, result)
// across a reload or navigating away and back - a refresh used to wipe all
// of it, even though the actual render kept going server-side regardless
// (see exportTimeline.js's early-202 job model). `building` staying true
// with a `jobId` present after restore means the caller should resume
// polling that job (see App.jsx) rather than assume it's lost.
export function usePersistedLongMixState() {
  const [songs, setSongs] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_LONGMIX_SETTINGS);
  const [building, setBuilding] = useState(false);
  const [jobId, setJobId] = useState('');
  const [result, setResult] = useState(null);
  const [restored, setRestored] = useState(false);

  const songIdsRef = useRef(new Set());
  const sceneIdsRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [restoredSongs, restoredScenes] = await Promise.all([
        restoreEntries(SONGS_KEY, 'song'),
        restoreEntries(SCENES_KEY, 'scene'),
      ]);

      let restoredSettings = DEFAULT_LONGMIX_SETTINGS;
      try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) restoredSettings = { ...DEFAULT_LONGMIX_SETTINGS, ...JSON.parse(stored) };
      } catch (error) {
        console.warn('Error restoring LongMix settings:', error);
      }

      let jobState = null;
      try {
        const stored = localStorage.getItem(JOB_KEY);
        if (stored) jobState = JSON.parse(stored);
      } catch (error) {
        console.warn('Error restoring LongMix job state:', error);
      }

      if (cancelled) return;

      songIdsRef.current = new Set(restoredSongs.map((song) => song.id));
      sceneIdsRef.current = new Set(restoredScenes.map((scene) => scene.id));
      setSongs(restoredSongs);
      setScenes(restoredScenes);
      setSettings(restoredSettings);
      if (jobState) {
        setResult(jobState.result || null);
        setBuilding(Boolean(jobState.building && jobState.jobId));
        setJobId(jobState.jobId || '');
      }
      setRestored(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => {
      persistEntries(SONGS_KEY, 'song', songs, songIdsRef);
      persistEntries(SCENES_KEY, 'scene', scenes, sceneIdsRef);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (error) {
        console.warn('Error persisting LongMix settings:', error);
      }
      try {
        localStorage.setItem(JOB_KEY, JSON.stringify({ jobId, building, result }));
      } catch (error) {
        console.warn('Error persisting LongMix job state:', error);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [restored, songs, scenes, settings, jobId, building, result]);

  return {
    songs,
    setSongs,
    scenes,
    setScenes,
    settings,
    setSettings,
    building,
    setBuilding,
    jobId,
    setJobId,
    result,
    setResult,
    restored,
  };
}

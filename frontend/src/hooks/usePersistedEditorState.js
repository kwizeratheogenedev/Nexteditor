import { useState, useEffect, useCallback } from 'react';
import { persistFile, getPersistedFile, removePersistedFile, clearAllPersistedFiles } from '../utils/indexedDB';
import { useAuth } from '../context/AuthContext.jsx';
import { API_ENDPOINTS } from '../config.js';

const STORAGE_PREFIX = 'nexeditor_editor_';
const SCHEMA_VERSION = 3;
const PROJECT_ID_KEY = `${STORAGE_PREFIX}projectId`;

function createEmptyTimeline() {
  return [];
}

// One entry per lane, per media type - lane count is just this array's
// length (an "empty" lane the user added via + Add track but hasn't put a
// clip on yet still needs a slot here to render/persist). `name: null` means
// "use the generic Video N / Audio N / Text N fallback" (see
// BottomTimeline.jsx laneLabelFor).
function defaultTrackMeta() {
  return {
    video: [{ locked: false, hidden: false, name: null }],
    audio: [{ locked: false, hidden: false, name: null }],
    text: [{ locked: false, hidden: false, name: null }],
  };
}

function defaultTransform() {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
}

// Per-property keyframe tracks (clip-local time, i.e. 0 = the clip's first
// visible output frame). Position/rotation/opacity are keyframeable; scale
// isn't yet - animating it requires a fundamentally different ffmpeg
// technique (zoompan or a pre-scaled-buffer + crop-window animation) since a
// single video stream can't vary frame dimensions over time the way
// position/rotation/opacity can vary as plain per-frame expressions.
function defaultKeyframes() {
  // `speed` points are in SOURCE-local time (0 = trimmedStart) and step
  // (not interpolate) the playback speed - see timeline/speedCurve.js.
  return { x: [], y: [], rotation: [], opacity: [], volume: [], speed: [] };
}

export function createSourceId() {
  return globalThis.crypto?.randomUUID?.() || `src-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultTextStyle() {
  return { content: 'Your text here', fontFamily: 'Inter, sans-serif', fontSize: 64, color: '#ffffff', align: 'center' };
}

// Fills in the per-clip editing fields (transform/filters/speed/volume) that
// every clip should carry, without clobbering ones already set. Applied on
// every clip creation/update so older saved clips missing these fields (or
// clips built before this schema existed) still behave correctly.
export function normalizeClip(clip) {
  const normalized = {
    type: 'video',
    // Which lane within its type: video 0 = base/background program, 1+ =
    // overlay tracks stacked on top (higher index = higher z-order,
    // foreground). Audio/text lanes are just parallel streams, no z-order
    // meaning. `startTime` is the clip's absolute position (seconds) on the
    // global timeline - callers that append sequentially (import, add-text,
    // add-audio) are responsible for computing a sensible value; this
    // default only covers clips that don't care (e.g. programmatic tests).
    trackIndex: 0,
    startTime: 0,
    transform: defaultTransform(),
    filters: [],
    speed: 1,
    volume: 1,
    muted: false,
    audioFade: { in: 0, out: 0 },
    transitionOut: null,
    // M11: groupId links clips selected/dragged as one unit (null = not
    // grouped); enabled:false skips the clip in preview/export without
    // deleting it; frozen marks a held-single-frame clip (see
    // backend/services/filterGraph/effects/trim.js's tpad hold); reversed
    // plays the clip's trimmed source range backward (frontend approximates
    // via reverse-direction seeking, export uses ffmpeg's reverse/areverse).
    groupId: null,
    enabled: true,
    frozen: false,
    reversed: false,
    // Optional per-clip organizational color override (null = fall back to
    // the type-based color) - purely a timeline display aid, never sent in
    // the export payload.
    color: null,
    ...clip,
    keyframes: { ...defaultKeyframes(), ...clip.keyframes },
  };
  if (normalized.type === 'text') {
    normalized.text = { ...defaultTextStyle(), ...clip.text };
  }
  return normalized;
}

// Text clips have no source media, so trimmedStart/trimmedEnd are just a
// 0..duration placeholder span rather than a real source in/out point -
// `startTime` (absolute position on the global timeline) and `trackIndex`
// (which text lane) are what actually place the clip; callers compute those.
export function createTextClip({ id, trackIndex = 0, startTime = 0, duration = 3, text } = {}) {
  return normalizeClip({
    id: id || `text-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: 'text',
    sourceId: null,
    trackIndex,
    startTime,
    trimmedStart: 0,
    trimmedEnd: duration,
    text,
  });
}

// Adjustment layer (M13) - no source media at all, lives on a VIDEO lane so
// its trackIndex determines z-order the same way an overlay clip's does:
// applies its color/vignette filters to every video lane already drawn
// below it within its own [startTime, startTime+duration) window, rather
// than drawing any content of its own. trimmedStart/trimmedEnd are a
// 0..duration placeholder exactly like a text clip's.
export function createAdjustmentClip({ id, trackIndex = 0, startTime = 0, duration = 3 } = {}) {
  return normalizeClip({
    id: id || `adjustment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: 'adjustment',
    sourceId: null,
    trackIndex,
    startTime,
    trimmedStart: 0,
    trimmedEnd: duration,
    label: 'Adjustment',
  });
}

// Standalone audio-track clips (music/voiceover) - independent source media.
// trimmedStart/trimmedEnd are the real source in/out point (which portion of
// the audio file plays); startTime/trackIndex place it on the timeline,
// independent of that source range.
export function createAudioClip({ id, sourceId, file, url, trackIndex = 0, startTime = 0, trimmedStart = 0, trimmedEnd }) {
  return normalizeClip({
    id: id || `audio-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: 'audio',
    sourceId,
    file,
    url,
    trackIndex,
    startTime,
    trimmedStart,
    trimmedEnd,
  });
}

// A v2 project has no trackIndex/startTime - position was implicit,
// derived by summing durations of everything before a clip in its per-type
// array. This walks a v2 clip array in its existing order and assigns
// trackIndex:0 + startTime using that exact old accumulation math (including
// transitionOut overlap subtraction for video), so a migrated project renders
// pixel-identical to before - just with the position now explicit instead of
// implicit. New multi-lane placement only becomes possible after this runs.
function migrateV2ToV3(clips) {
  let videoCursor = 0;
  let audioCursor = 0;
  let textCursor = 0;
  const videoClipDurations = clips
    .filter((clip) => (clip.type || 'video') === 'video')
    .map((clip) => (clip.trimmedEnd - clip.trimmedStart) / (clip.speed || 1));
  let videoIndex = 0;

  return clips.map((clip) => {
    const type = clip.type || 'video';
    const speed = clip.speed || 1;
    const duration = type === 'text'
      ? (clip.trimmedEnd - clip.trimmedStart)
      : (clip.trimmedEnd - clip.trimmedStart) / speed;

    if (type === 'text') {
      const startTime = textCursor;
      textCursor += duration;
      return { ...clip, trackIndex: 0, startTime };
    }

    if (type === 'audio') {
      const startTime = audioCursor;
      audioCursor += duration;
      return { ...clip, trackIndex: 0, startTime };
    }

    // Video: mirrors the pre-M7 computeVideoOffsets - a clip's transitionOut
    // pulls the *next* video clip's start earlier by the overlap duration,
    // clamped against both this clip's and the next clip's own duration.
    const startTime = videoCursor;
    const nextDuration = videoClipDurations[videoIndex + 1] ?? 0;
    const transitionDuration = clip.transitionOut?.duration
      ? Math.max(0, Math.min(clip.transitionOut.duration, duration, nextDuration))
      : 0;
    videoCursor += duration - transitionDuration;
    videoIndex += 1;
    return { ...clip, trackIndex: 0, startTime };
  });
}

export function usePersistedEditorState() {
  const [timeline, setTimeline] = useState(() => createEmptyTimeline());
  const [playhead, setPlayhead] = useState(0);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [bannerVisible, setBannerVisible] = useState(true);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [selectedClipIds, setSelectedClipIds] = useState([]);
  const [expandedTracks, setExpandedTracks] = useState({ video: true, audio: false, text: false });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [autoFollowPlayhead, setAutoFollowPlayhead] = useState(true);
  const [insertMode, setInsertMode] = useState(false);
  const [trackMeta, setTrackMeta] = useState(() => defaultTrackMeta());
  // Timeline markers (M13) - named points on the global timeline, not tied
  // to any clip. {id, time, label} - label:null falls back to the time in
  // the UI, same "null means use a generic fallback" convention trackMeta's
  // lane names already use.
  const [markers, setMarkers] = useState([]);
  const [restored, setRestored] = useState(false);
  const [timelineHistory, setTimelineHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Backend project sync (M4) - additive to the localStorage/IndexedDB
  // persistence above, which stays the instant local cache exactly as
  // before. currentProjectId is null until the user explicitly saves the
  // project to their account (saveProjectToAccount); after that, edits
  // debounce-sync to the backend so the project (and any unfinished work)
  // survives logout.
  const [currentProjectId, setCurrentProjectId] = useState(() => {
    try {
      return localStorage.getItem(PROJECT_ID_KEY) || null;
    } catch {
      return null;
    }
  });
  const [projectName, setProjectName] = useState('Untitled project');
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const { user } = useAuth();

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const stored = localStorage.getItem(`${STORAGE_PREFIX}timeline`);
        if (!stored) {
          if (!cancelled) setRestored(true);
          return;
        }

        const parsed = JSON.parse(stored);
        // v1 (the old, buggy array-spread format) never actually restored
        // correctly, so there's no real data to salvage from it - treated as
        // unrecoverable. v2 is a valid format missing only trackIndex/
        // startTime (position was implicit) - migrateV2ToV3 backfills those
        // from the exact old accumulation math, below.
        if (!parsed || !Array.isArray(parsed.clips) || parsed.clips.length === 0 || (parsed.version !== 2 && parsed.version !== SCHEMA_VERSION)) {
          if (!cancelled) setRestored(true);
          return;
        }
        const clipsToRestore = parsed.version === 2 ? migrateV2ToV3(parsed.clips) : parsed.clips;

        // Multiple clips (e.g. both halves of a split) can share the same
        // underlying source file - fetch and create a blob URL for each
        // unique source only once.
        const sourceCache = new Map();
        const restoredClips = [];
        for (const clip of clipsToRestore) {
          let resolved = clip.sourceId ? sourceCache.get(clip.sourceId) : null;
          if (!resolved && clip.sourceId) {
            const file = await getPersistedFile(`${STORAGE_PREFIX}source_${clip.sourceId}`);
            resolved = file ? { file, url: URL.createObjectURL(file) } : { file: null, url: '' };
            sourceCache.set(clip.sourceId, resolved);
          }
          // A clip with no locally-stored source blob may still have a
          // stable, non-blob remote URL (e.g. a clip pulled in from a
          // Montage output already hosted by the backend) - that URL is
          // safe to persist and restore directly, unlike a session-scoped
          // blob: URL.
          restoredClips.push(normalizeClip({ ...clip, file: resolved?.file || null, url: resolved?.url || clip.remoteUrl || '' }));
        }

        if (!cancelled) {
          setTimeline(restoredClips);
          setPlayhead(parsed.playhead || 0);
          setActiveClipIndex(parsed.activeClipIndex || 0);
          setZoom(parsed.zoom || 100);
          setBannerVisible(parsed.bannerVisible !== false);
          setSelectedClipId(parsed.selectedClipId || null);
          setSelectedClipIds(Array.isArray(parsed.selectedClipIds) ? parsed.selectedClipIds : []);
          setExpandedTracks(parsed.expandedTracks || { video: true, audio: false, text: false });
          setSnapEnabled(parsed.snapEnabled !== false);
          setAutoFollowPlayhead(parsed.autoFollowPlayhead !== false);
          setInsertMode(parsed.insertMode === true);
          // Older saved projects (pre-M9) have no trackMeta at all - default
          // to a single unlocked/visible lane per type, same as a brand new
          // project, rather than trying to infer lane state from clips.
          setTrackMeta(parsed.trackMeta || defaultTrackMeta());
          setMarkers(Array.isArray(parsed.markers) ? parsed.markers : []);
          setRestored(true);
        }
      } catch (error) {
        console.warn('Error restoring editor state:', error);
        if (!cancelled) setRestored(true);
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restored) return;

    const timer = setTimeout(async () => {
      try {
        const clips = timeline.map(({ file, url, ...rest }) => ({
          ...rest,
          // Blob URLs die with the browser session and must be regenerated
          // from the stored source file on restore; a non-blob URL (a clip
          // hosted by the backend) is stable and worth keeping directly.
          ...(url && !url.startsWith('blob:') ? { remoteUrl: url } : {}),
        }));
        const stateToSave = {
          version: SCHEMA_VERSION,
          clips,
          playhead,
          activeClipIndex,
          zoom,
          bannerVisible,
          selectedClipId,
          selectedClipIds,
          expandedTracks,
          snapEnabled,
          autoFollowPlayhead,
          insertMode,
          trackMeta,
          markers,
        };

        localStorage.setItem(`${STORAGE_PREFIX}timeline`, JSON.stringify(stateToSave));

        const seenSourceIds = new Set();
        for (const clip of timeline) {
          if (!clip.sourceId || seenSourceIds.has(clip.sourceId)) continue;
          seenSourceIds.add(clip.sourceId);
          if (clip.file instanceof File) {
            await persistFile(`${STORAGE_PREFIX}source_${clip.sourceId}`, clip.file);
          }
        }

        // Sweep any source blobs that are no longer referenced by any clip
        // (e.g. the clip that used them was deleted) so IndexedDB doesn't
        // grow unbounded across a long editing session.
        const knownKey = `${STORAGE_PREFIX}known_sources`;
        let previouslyKnown = [];
        try {
          previouslyKnown = JSON.parse(localStorage.getItem(knownKey) || '[]');
        } catch { /* treat as empty */ }
        const orphaned = previouslyKnown.filter((id) => !seenSourceIds.has(id));
        for (const id of orphaned) {
          await removePersistedFile(`${STORAGE_PREFIX}source_${id}`);
        }
        localStorage.setItem(knownKey, JSON.stringify([...seenSourceIds]));
      } catch (error) {
        console.warn('Error persisting editor state:', error);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [restored, timeline, playhead, activeClipIndex, zoom, bannerVisible, selectedClipId, selectedClipIds, expandedTracks, snapEnabled, autoFollowPlayhead, insertMode, trackMeta, markers]);

  // Backend sync - only runs once a project has been explicitly saved to the
  // account (currentProjectId set) and the user is signed in. Longer debounce
  // than the localStorage effect above since this is a network call, not a
  // local write.
  useEffect(() => {
    if (!restored || !user || !currentProjectId) return;

    const timer = setTimeout(async () => {
      try {
        setSyncStatus('saving');
        const clips = timeline.map(({ file, url, ...rest }) => ({
          ...rest,
          ...(url && !url.startsWith('blob:') ? { remoteUrl: url } : {}),
        }));
        const data = {
          version: SCHEMA_VERSION,
          clips,
          playhead,
          activeClipIndex,
          zoom,
          bannerVisible,
          selectedClipId,
          selectedClipIds,
          expandedTracks,
          snapEnabled,
          autoFollowPlayhead,
          insertMode,
          trackMeta,
          markers,
        };
        const res = await fetch(API_ENDPOINTS.project(currentProjectId), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: projectName, data }),
        });
        if (!res.ok) throw new Error('Sync failed');
        setSyncStatus('saved');
      } catch (error) {
        console.warn('Error syncing project to account:', error);
        setSyncStatus('error');
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [restored, user, currentProjectId, projectName, timeline, playhead, activeClipIndex, zoom, bannerVisible, selectedClipId, selectedClipIds, expandedTracks, snapEnabled, autoFollowPlayhead, insertMode, trackMeta, markers]);

  useEffect(() => {
    try {
      if (currentProjectId) localStorage.setItem(PROJECT_ID_KEY, currentProjectId);
      else localStorage.removeItem(PROJECT_ID_KEY);
    } catch { /* ignore */ }
  }, [currentProjectId]);

  // Saves the current in-progress timeline as a new backend project (subject
  // to the free-tier project cap enforced server-side). Throws on failure
  // (e.g. {code:'UPGRADE_REQUIRED'}) so the caller can show the upgrade
  // prompt rather than failing silently.
  const saveProjectToAccount = useCallback(async (name) => {
    const clips = timeline.map(({ file, url, ...rest }) => ({
      ...rest,
      ...(url && !url.startsWith('blob:') ? { remoteUrl: url } : {}),
    }));
    const data = {
      version: SCHEMA_VERSION,
      clips,
      playhead,
      activeClipIndex,
      zoom,
      bannerVisible,
      selectedClipId,
      selectedClipIds,
      expandedTracks,
      snapEnabled,
      autoFollowPlayhead,
      insertMode,
      trackMeta,
      markers,
    };
    const res = await fetch(API_ENDPOINTS.projects, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'editor', name: name || 'Untitled project', data }),
    });
    const payload = await res.json();
    if (!res.ok) {
      const error = new Error(payload.error || 'Failed to save project.');
      error.code = payload.code;
      throw error;
    }
    setCurrentProjectId(payload.project._id);
    setProjectName(payload.project.name);
    setSyncStatus('saved');
    return payload.project;
  }, [timeline, playhead, activeClipIndex, zoom, bannerVisible, selectedClipId, selectedClipIds, expandedTracks, snapEnabled, autoFollowPlayhead, insertMode, trackMeta, markers]);

  // Loads a project previously saved to the account (e.g. picked from the
  // "My Projects" list) and replaces the live timeline with it. Local source
  // blobs only exist if they were persisted to THIS browser's IndexedDB
  // (same-browser restore, per M4's scope) - clips referencing sources not
  // found locally restore with an empty url, same fallback the mount-time
  // restore already handles.
  const loadProjectFromAccount = useCallback(async (id) => {
    const res = await fetch(API_ENDPOINTS.project(id), { credentials: 'include' });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to load project.');
    const parsed = payload.project.data;

    const sourceCache = new Map();
    const restoredClips = [];
    for (const clip of parsed.clips || []) {
      let resolved = clip.sourceId ? sourceCache.get(clip.sourceId) : null;
      if (!resolved && clip.sourceId) {
        const file = await getPersistedFile(`${STORAGE_PREFIX}source_${clip.sourceId}`);
        resolved = file ? { file, url: URL.createObjectURL(file) } : { file: null, url: '' };
        sourceCache.set(clip.sourceId, resolved);
      }
      restoredClips.push(normalizeClip({ ...clip, file: resolved?.file || null, url: resolved?.url || clip.remoteUrl || '' }));
    }

    setTimeline(restoredClips);
    setPlayhead(parsed.playhead || 0);
    setActiveClipIndex(parsed.activeClipIndex || 0);
    setZoom(parsed.zoom || 100);
    setBannerVisible(parsed.bannerVisible !== false);
    setSelectedClipId(parsed.selectedClipId || null);
    setSelectedClipIds(Array.isArray(parsed.selectedClipIds) ? parsed.selectedClipIds : []);
    setExpandedTracks(parsed.expandedTracks || { video: true, audio: false, text: false });
    setSnapEnabled(parsed.snapEnabled !== false);
    setAutoFollowPlayhead(parsed.autoFollowPlayhead !== false);
    setInsertMode(parsed.insertMode === true);
    setTrackMeta(parsed.trackMeta || defaultTrackMeta());
    setMarkers(Array.isArray(parsed.markers) ? parsed.markers : []);
    setTimelineHistory([]);
    setHistoryIndex(-1);
    setCurrentProjectId(payload.project._id);
    setProjectName(payload.project.name);
    setSyncStatus('saved');
  }, []);

  const clearAll = useCallback(() => {
    timeline.forEach((clip) => {
      if (clip.url && clip.url.startsWith('blob:')) {
        URL.revokeObjectURL(clip.url);
      }
    });
    setTimeline(createEmptyTimeline());
    setPlayhead(0);
    setActiveClipIndex(0);
    setIsPlaying(false);
    setZoom(100);
    setBannerVisible(true);
    setSelectedClipId(null);
    setSelectedClipIds([]);
    setExpandedTracks({ video: true, audio: false, text: false });
    setSnapEnabled(true);
    setAutoFollowPlayhead(true);
    setInsertMode(false);
    setTrackMeta(defaultTrackMeta());
    setMarkers([]);
    setTimelineHistory([]);
    setHistoryIndex(-1);
    setCurrentProjectId(null);
    setProjectName('Untitled project');
    setSyncStatus('idle');

    localStorage.removeItem(`${STORAGE_PREFIX}timeline`);
    localStorage.removeItem(`${STORAGE_PREFIX}known_sources`);
    clearAllPersistedFiles();
  }, [timeline]);

  const pushHistory = useCallback((nextTimeline) => {
    setTimelineHistory((prev) => {
      const sliced = prev.slice(0, historyIndex + 1);
      // Shallow copy only: clip objects are treated as immutable (every
      // mutation site replaces a clip with a new object rather than mutating
      // it in place), so a shallow array copy is enough to snapshot this
      // state. A deep JSON clone would silently corrupt each clip's `file`
      // (a File object has no enumerable own properties, so JSON round-trips
      // it to `{}`), breaking export/playback after any undo/redo.
      const next = [...sliced, nextTimeline.slice()].slice(-50);
      setHistoryIndex(next.length - 1);
      return next;
    });
  }, [historyIndex]);

  // Wraps a timeline mutation (value or updater) together with a history
  // snapshot of the result, for discrete edits (add/split/delete/duplicate).
  // High-frequency gestures (trim-drag, clip-drag) should call the raw
  // `setTimeline` while dragging and push a single history snapshot once,
  // at gesture end, instead of using this on every intermediate move.
  const commitTimeline = useCallback((updaterOrValue) => {
    setTimeline((prev) => {
      const next = typeof updaterOrValue === 'function' ? updaterOrValue(prev) : updaterOrValue;
      pushHistory(next);
      return next;
    });
  }, [pushHistory]);

  const addClip = useCallback((clip) => {
    commitTimeline((prev) => [...prev, normalizeClip(clip)]);
  }, [commitTimeline]);

  const updateClip = useCallback((id, updater) => {
    commitTimeline((prev) => prev.map((clip) => {
      if (clip.id !== id) return clip;
      return typeof updater === 'function' ? normalizeClip(updater(clip)) : normalizeClip({ ...clip, ...updater });
    }));
  }, [commitTimeline]);

  const removeClip = useCallback((id) => {
    commitTimeline((prev) => {
      const clip = prev.find((c) => c.id === id);
      if (clip?.url && clip.url.startsWith('blob:')) {
        URL.revokeObjectURL(clip.url);
      }
      return prev.filter((c) => c.id !== id);
    });
  }, [commitTimeline]);

  // Reads historyIndex/timelineHistory directly rather than reaching for the
  // latest value via setTimelineHistory's updater function - that updater
  // was only ever used to peek at `prev` (it always returned it unchanged),
  // which calls setHistoryIndex/setTimeline as a side effect of an updater
  // meant to be pure. React may invoke an updater more than once per commit
  // (e.g. StrictMode's dev-mode double-invoke), which would double-fire
  // those side effects.
  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const snapshot = timelineHistory[newIndex];
    setHistoryIndex(newIndex);
    if (snapshot) setTimeline(snapshot.slice());
  }, [historyIndex, timelineHistory]);

  const redo = useCallback(() => {
    if (historyIndex >= timelineHistory.length - 1) return;
    const newIndex = historyIndex + 1;
    const snapshot = timelineHistory[newIndex];
    setHistoryIndex(newIndex);
    if (snapshot) setTimeline(snapshot.slice());
  }, [historyIndex, timelineHistory]);

  return {
    timeline,
    setTimeline,
    commitTimeline,
    pushHistory,
    addClip,
    updateClip,
    removeClip,
    playhead,
    setPlayhead,
    activeClipIndex,
    setActiveClipIndex,
    isPlaying,
    setIsPlaying,
    zoom,
    setZoom,
    bannerVisible,
    setBannerVisible,
    selectedClipId,
    setSelectedClipId,
    selectedClipIds,
    setSelectedClipIds,
    expandedTracks,
    setExpandedTracks,
    snapEnabled,
    setSnapEnabled,
    autoFollowPlayhead,
    setAutoFollowPlayhead,
    insertMode,
    setInsertMode,
    trackMeta,
    setTrackMeta,
    markers,
    setMarkers,
    clearAll,
    restored,
    timelineHistory,
    historyIndex,
    setTimelineHistory,
    setHistoryIndex,
    undo,
    redo,
    currentProjectId,
    projectName,
    setProjectName,
    syncStatus,
    saveProjectToAccount,
    loadProjectFromAccount,
  };
}

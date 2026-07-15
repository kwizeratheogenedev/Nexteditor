import { useState, useEffect, useCallback } from 'react';
import { persistFile, getPersistedFile, removePersistedFile, clearAllPersistedFiles } from '../utils/indexedDB';

const STORAGE_PREFIX = 'nexeditor_editor_';

function createEmptyTimeline() {
  return [];
}

export function usePersistedEditorState() {
  const [timeline, setTimeline] = useState(() => createEmptyTimeline());
  const [playhead, setPlayhead] = useState(0);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [bannerVisible, setBannerVisible] = useState(true);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const timelineKey = `${STORAGE_PREFIX}timeline`;
        const stored = localStorage.getItem(timelineKey);
        if (!stored) {
          if (!cancelled) setRestored(true);
          return;
        }

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          if (!cancelled) setRestored(true);
          return;
        }

        const restoredClips = [];
        for (let i = 0; i < parsed.length; i += 1) {
          const clip = parsed[i];
          const fileKey = `${STORAGE_PREFIX}clip_${i}`;
          
          let file = null;
          if (clip.fileName) {
            file = await getPersistedFile(fileKey);
          }

          restoredClips.push({
            ...clip,
            file: file || null,
          });
        }

        if (!cancelled) {
          setTimeline(restoredClips);
          setPlayhead(parsed.playhead || 0);
          setActiveClipIndex(parsed.activeClipIndex || 0);
          setZoom(parsed.zoom || 100);
          setBannerVisible(parsed.bannerVisible !== false);
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
        const serializable = timeline.map((clip) => ({
          ...clip,
          file: undefined,
        }));
        
        const stateToSave = {
          ...serializable,
          playhead,
          activeClipIndex,
          zoom,
          bannerVisible,
        };

        localStorage.setItem(`${STORAGE_PREFIX}timeline`, JSON.stringify(stateToSave));

        for (let i = 0; i < timeline.length; i += 1) {
          const clip = timeline[i];
          const fileKey = `${STORAGE_PREFIX}clip_${i}`;
          if (clip.file instanceof File) {
            await persistFile(fileKey, clip.file);
          }
        }

        for (let i = timeline.length; ; i += 1) {
          const fileKey = `${STORAGE_PREFIX}clip_${i}`;
          const exists = await getPersistedFile(fileKey);
          if (!exists) break;
          await removePersistedFile(fileKey);
        }
      } catch (error) {
        console.warn('Error persisting editor state:', error);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [restored, timeline, playhead, activeClipIndex, zoom, bannerVisible]);

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

    localStorage.removeItem(`${STORAGE_PREFIX}timeline`);
    clearAllPersistedFiles();
  }, [timeline]);

  const addClip = useCallback((clip) => {
    setTimeline((prev) => [...prev, clip]);
  }, []);

  const updateClip = useCallback((index, updater) => {
    setTimeline((prev) => {
      const next = [...prev];
      next[index] = typeof updater === 'function' ? updater(next[index]) : { ...next[index], ...updater };
      return next;
    });
  }, []);

  const removeClip = useCallback((index) => {
    setTimeline((prev) => {
      const clip = prev[index];
      if (clip?.url && clip.url.startsWith('blob:')) {
        URL.revokeObjectURL(clip.url);
      }
      return prev.filter((_, i) => i !== index);
    });
    setActiveClipIndex((prev) => Math.max(0, Math.min(prev, Math.max(0, timeline.length - 2))));
  }, [timeline.length]);

  return {
    timeline,
    setTimeline,
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
    clearAll,
    restored,
  };
}

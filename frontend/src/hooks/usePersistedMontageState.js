import { useState, useEffect, useCallback } from 'react';
import { persistFile, getPersistedFile, removePersistedFile } from '../utils/indexedDB';

const STORAGE_PREFIX = 'nexeditor_montage_';

function createVideoSlot(id) {
  return { id, sourceMode: 'device', file: null, url: '', filePath: '', fileName: '', duration: null, status: 'idle', progress: 0, error: '' };
}

function createAudioSlot() {
  return { sourceMode: 'device', file: null, url: '', filePath: '', fileName: '', duration: null, status: 'idle', progress: 0, error: '' };
}

async function restoreSlot(storageKey, fileKey, initialValue) {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return initialValue;

    const parsed = JSON.parse(stored);
    if (!parsed.fileName && !parsed.filePath) return initialValue;

    let file = null;
    if (parsed.sourceMode === 'device' && parsed.fileName) {
      file = await getPersistedFile(fileKey);
    }

    return {
      ...initialValue,
      ...parsed,
      file: file || null,
    };
  } catch (error) {
    console.warn(`Error restoring slot "${storageKey}":`, error);
    return initialValue;
  }
}

async function persistSlot(storageKey, fileKey, slotState) {
  try {
    const { file, ...serializable } = slotState;
    localStorage.setItem(storageKey, JSON.stringify(serializable));

    if (file instanceof File) {
      await persistFile(fileKey, file);
    } else if (!file && !serializable.filePath) {
      await removePersistedFile(fileKey);
    }
  } catch (error) {
    console.warn(`Error persisting slot "${storageKey}":`, error);
  }
}

export function usePersistedMontageState() {
  const [videos, setVideos] = useState(() => [createVideoSlot(1), createVideoSlot(2), createVideoSlot(3)]);
  const [audio, setAudio] = useState(() => createAudioSlot());
  const [mergeStatus, setMergeStatus] = useState('idle');
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStageText, setMergeStageText] = useState('');
  const [mergeTotalEstimatedTime, setMergeTotalEstimatedTime] = useState(0);
  const [mergeTimeSpent, setMergeTimeSpent] = useState(0);
  const [mergeTimeLeft, setMergeTimeLeft] = useState(0);
  const [mergeError, setMergeError] = useState('');
  const [outputFile, setOutputFile] = useState({ filePath:'', fileName:'', downloadName:'', duration:'', size:'' });
  const [hasRealProgress, setHasRealProgress] = useState(false);
  const [lastProgressUpdate, setLastProgressUpdate] = useState(() => Date.now());
  const [syncMode, setSyncMode] = useState('beat');
  const [tempoSensitivity, setTempoSensitivity] = useState('medium');
  const [videoQuality, setVideoQuality] = useState('high');
  const [beautyStyle, setBeautyStyle] = useState('cinematic');
  const [enhanceMotion, setEnhanceMotion] = useState(true);
  const [colorBoost, setColorBoost] = useState(false);
  const [smoothTransitions, setSmoothTransitions] = useState(true);
  const [contrastPolish, setContrastPolish] = useState(true);

  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const videoPromises = [0, 1, 2].map((index) => {
        const storageKey = `${STORAGE_PREFIX}video_${index}`;
        const fileKey = `${storageKey}_file`;
        return restoreSlot(storageKey, fileKey, createVideoSlot(index + 1));
      });

      const audioStorageKey = `${STORAGE_PREFIX}audio`;
      const audioFileKey = `${audioStorageKey}_file`;
      const audioPromise = restoreSlot(audioStorageKey, audioFileKey, createAudioSlot());

      const processingStorageKey = `${STORAGE_PREFIX}processing`;
      let processingState = null;
      try {
        const stored = localStorage.getItem(processingStorageKey);
        if (stored) {
          processingState = JSON.parse(stored);
        }
      } catch (error) {
        console.warn('Error restoring processing state:', error);
      }

      const [v0, v1, v2, a] = await Promise.all([...videoPromises, audioPromise]);

      if (!cancelled) {
        setVideos([v0, v1, v2]);
        setAudio(a);

        if (processingState) {
          // A 'processing' status persisted from a previous page load has no
          // live request behind it anymore (the fetch promise that would have
          // resolved it is gone) - trusting it as-is would strand the UI at
          // ~99% forever. Treat it as unknown instead of resuming it.
          const wasStillProcessing = processingState.mergeStatus === 'processing';
          setMergeStatus(wasStillProcessing ? 'error' : (processingState.mergeStatus || 'idle'));
          setMergeProgress(wasStillProcessing ? 0 : (processingState.mergeProgress || 0));
          setMergeStageText(wasStillProcessing ? '' : (processingState.mergeStageText || ''));
          setMergeTotalEstimatedTime(processingState.mergeTotalEstimatedTime || 0);
          setMergeTimeSpent(processingState.mergeTimeSpent || 0);
          setMergeTimeLeft(processingState.mergeTimeLeft || 0);
          setMergeError(wasStillProcessing
            ? 'Your previous montage job was interrupted by a page reload. Please check your downloads, or start a new merge.'
            : (processingState.mergeError || ''));
          setOutputFile(processingState.outputFile || { filePath:'', fileName:'', downloadName:'', duration:'', size:'' });
          setHasRealProgress(wasStillProcessing ? false : (processingState.hasRealProgress || false));
          setLastProgressUpdate(processingState.lastProgressUpdate || Date.now());
          setSyncMode(processingState.syncMode || 'beat');
          setTempoSensitivity(processingState.tempoSensitivity || 'medium');
          setVideoQuality(processingState.videoQuality || 'high');
          setBeautyStyle(processingState.beautyStyle || 'cinematic');
          setEnhanceMotion(processingState.enhanceMotion ?? true);
          setColorBoost(processingState.colorBoost || false);
          setSmoothTransitions(processingState.smoothTransitions ?? true);
          setContrastPolish(processingState.contrastPolish ?? true);
        }

        setRestored(true);
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restored) return;

    const timer = setTimeout(() => {
      videos.forEach((video, index) => {
        const storageKey = `${STORAGE_PREFIX}video_${index}`;
        const fileKey = `${storageKey}_file`;
        persistSlot(storageKey, fileKey, video);
      });

      const audioStorageKey = `${STORAGE_PREFIX}audio`;
      const audioFileKey = `${audioStorageKey}_file`;
      persistSlot(audioStorageKey, audioFileKey, audio);

      const processingState = {
        mergeStatus,
        mergeProgress,
        mergeStageText,
        mergeTotalEstimatedTime,
        mergeTimeSpent,
        mergeTimeLeft,
        mergeError,
        outputFile,
        hasRealProgress,
        lastProgressUpdate,
        syncMode,
        tempoSensitivity,
        videoQuality,
        beautyStyle,
        enhanceMotion,
        colorBoost,
        smoothTransitions,
        contrastPolish,
      };

      try {
        localStorage.setItem(`${STORAGE_PREFIX}processing`, JSON.stringify(processingState));
      } catch (error) {
        console.warn('Error persisting processing state:', error);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [restored, videos, audio, mergeStatus, mergeProgress, mergeStageText, mergeTotalEstimatedTime, mergeTimeSpent, mergeTimeLeft, mergeError, outputFile, hasRealProgress, lastProgressUpdate, syncMode, tempoSensitivity, videoQuality, beautyStyle, enhanceMotion, colorBoost, smoothTransitions, contrastPolish]);

  const updateVideo = useCallback((index, updater) => {
    setVideos((prev) => {
      const next = [...prev];
      next[index] = typeof updater === 'function' ? updater(next[index]) : { ...next[index], ...updater };
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setVideos([createVideoSlot(1), createVideoSlot(2), createVideoSlot(3)]);
    setAudio(createAudioSlot());
    setMergeStatus('idle');
    setMergeProgress(0);
    setMergeStageText('');
    setMergeTotalEstimatedTime(0);
    setMergeTimeSpent(0);
    setMergeTimeLeft(0);
    setMergeError('');
    setOutputFile({ filePath:'', fileName:'', downloadName:'', duration:'', size:'' });
    setHasRealProgress(false);
    setLastProgressUpdate(Date.now());
    setSyncMode('beat');
    setTempoSensitivity('medium');
    setVideoQuality('high');
    setBeautyStyle('cinematic');
    setEnhanceMotion(true);
    setColorBoost(false);
    setSmoothTransitions(true);
    setContrastPolish(true);

    for (let i = 0; i < 3; i += 1) {
      localStorage.removeItem(`${STORAGE_PREFIX}video_${i}`);
      removePersistedFile(`${STORAGE_PREFIX}video_${i}_file`);
    }
    localStorage.removeItem(`${STORAGE_PREFIX}audio`);
    removePersistedFile(`${STORAGE_PREFIX}audio_file`);
    localStorage.removeItem(`${STORAGE_PREFIX}processing`);
  }, []);

  return {
    videos,
    setVideos,
    updateVideo,
    audio,
    setAudio,
    mergeStatus,
    setMergeStatus,
    mergeProgress,
    setMergeProgress,
    mergeStageText,
    setMergeStageText,
    mergeTotalEstimatedTime,
    setMergeTotalEstimatedTime,
    mergeTimeSpent,
    setMergeTimeSpent,
    mergeTimeLeft,
    setMergeTimeLeft,
    mergeError,
    setMergeError,
    outputFile,
    setOutputFile,
    hasRealProgress,
    setHasRealProgress,
    lastProgressUpdate,
    setLastProgressUpdate,
    syncMode,
    setSyncMode,
    tempoSensitivity,
    setTempoSensitivity,
    videoQuality,
    setVideoQuality,
    beautyStyle,
    setBeautyStyle,
    enhanceMotion,
    setEnhanceMotion,
    colorBoost,
    setColorBoost,
    smoothTransitions,
    setSmoothTransitions,
    contrastPolish,
    setContrastPolish,
    clearAll,
    restored,
  };
}

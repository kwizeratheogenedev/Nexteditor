import { useState } from 'react';
import { usePersistedState } from './usePersistedState';
import { usePersistedEditorState } from './usePersistedEditorState';
import {
  KEY_ACTIVE_TAB,
  KEY_AUDIO_META,
  KEY_CAPTION_FILE_META,
  KEY_CAPTION_VIDEO_META,
  KEY_SHORTS_DURATION,
  KEY_SHORTS_FORMAT,
  KEY_SHORTS_VIDEO_META,
  KEY_VIDEO1_META,
  KEY_VIDEO2_META,
  KEY_VIDEO3_META,
} from '../constants/storageKeys';

const createInitialFieldState = () => ({
  sourceMode: 'device',
  file: null,
  url: '',
  filePath: '',
  fileName: '',
  duration: null,
  status: 'idle',
  progress: 0,
  error: '',
});

export function useMediaState() {
  const [activeTab, setActiveTab] = usePersistedState(KEY_ACTIVE_TAB, 'editor');

  // Consolidated video state (replaces video1State, video2State, video3State and video1, video2, video3)
  const [video1State, setVideo1State] = useState(createInitialFieldState());
  const [video2State, setVideo2State] = useState(createInitialFieldState());
  const [video3State, setVideo3State] = useState(createInitialFieldState());
  const [video1Meta, setVideo1Meta] = usePersistedState(KEY_VIDEO1_META, null);
  const [video2Meta, setVideo2Meta] = usePersistedState(KEY_VIDEO2_META, null);
  const [video3Meta, setVideo3Meta] = usePersistedState(KEY_VIDEO3_META, null);

  // Consolidated audio state (replaces audioState and audio)
  const [audioState, setAudioState] = useState(createInitialFieldState());
  const [audioMeta, setAudioMeta] = usePersistedState(KEY_AUDIO_META, null);

  // Consolidated caption state (replaces captionVideo, captionFile)
  const [captionVideoState, setCaptionVideoState] = useState(createInitialFieldState());
  const [captionFileState, setCaptionFileState] = useState(createInitialFieldState());
  const [captionVideoMeta, setCaptionVideoMeta] = usePersistedState(KEY_CAPTION_VIDEO_META, null);
  const [captionFileMeta, setCaptionFileMeta] = usePersistedState(KEY_CAPTION_FILE_META, null);

  // Consolidated shorts state (replaces shortsVideo, shortsResults)
  const [shortsVideoState, setShortsVideoState] = useState(createInitialFieldState());
  const [shortsVideoMeta, setShortsVideoMeta] = usePersistedState(KEY_SHORTS_VIDEO_META, null);
  const [shortsDuration, setShortsDuration] = usePersistedState(KEY_SHORTS_DURATION, '60');
  const [shortsFormat, setShortsFormat] = usePersistedState(KEY_SHORTS_FORMAT, '9:16');
  const [shortsResults, setShortsResults] = useState(null);
  const [selectedShortId, setSelectedShortId] = useState(null);

  // UI state
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(null);
  const [resultTab, setResultTab] = useState(null);
  const [errorText, setErrorText] = useState(null);
  const [progress, setProgress] = useState({ percent: 0, currentTime: '' });

  // Editor state
  const editor = usePersistedEditorState();
  const {
    timeline: editorTimeline,
    setTimeline: setEditorTimeline,
    commitTimeline: commitEditorTimeline,
    pushHistory: pushEditorHistory,
    updateClip: updateEditorClip,
    playhead: editorPlayhead,
    setPlayhead: setEditorPlayhead,
    isPlaying: editorIsPlaying,
    setIsPlaying: setEditorIsPlaying,
    activeClipIndex: editorActiveClipIndex,
    setActiveClipIndex: setEditorActiveClipIndex,
    zoom: timelineZoom,
    setZoom: setTimelineZoom,
    bannerVisible: editorBannerVisible,
    setBannerVisible: setEditorBannerVisible,
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
    clearAll: clearEditorState,
  } = editor;
  const undo = editor.undo;
  const redo = editor.redo;
  const [editorVideo, setEditorVideo] = useState({ filePath: '', fileName: '' });
  const [dragState, setDragState] = useState({ active: false, clipId: null, startX: 0, currentX: 0, startY: 0, currentY: 0, sourceIndex: -1, selectedIds: [], originals: null });
  const [trimState, setTrimState] = useState({ active: false, clipId: null, side: null, startX: 0, originalStart: 0, originalEnd: 0, originalStartTime: 0 });
  const [playheadDrag, setPlayheadDrag] = useState(false);

  // Preview state
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewIsPlaying, setPreviewIsPlaying] = useState(false);

  // Helper function to load video in editor from montage
  const loadVideoInEditor = (filePath, fileName) => {
    setEditorVideo({ filePath, fileName });
    setActiveTab('editor');
  };

  return {
    // Tab management
    activeTab,
    setActiveTab,

    // Video state
    video1State,
    setVideo1State,
    video1Meta,
    setVideo1Meta,
    video2State,
    setVideo2State,
    video2Meta,
    setVideo2Meta,
    video3State,
    setVideo3State,
    video3Meta,
    setVideo3Meta,

    // Audio state
    audioState,
    setAudioState,
    audioMeta,
    setAudioMeta,

    // Caption state
    captionVideoState,
    setCaptionVideoState,
    captionVideoMeta,
    setCaptionVideoMeta,
    captionFileState,
    setCaptionFileState,
    captionFileMeta,
    setCaptionFileMeta,

    // Shorts state
    shortsVideoState,
    setShortsVideoState,
    shortsVideoMeta,
    setShortsVideoMeta,
    shortsDuration,
    setShortsDuration,
    shortsFormat,
    setShortsFormat,
    shortsResults,
    setShortsResults,
    selectedShortId,
    setSelectedShortId,

    // UI state
    processing,
    setProcessing,
    resultUrl,
    setResultUrl,
    resultTab,
    setResultTab,
    errorText,
    setErrorText,
    progress,
    setProgress,

    // Editor state
    editorBannerVisible,
    setEditorBannerVisible,
    editorTimeline,
    setEditorTimeline,
    commitEditorTimeline,
    pushEditorHistory,
    updateEditorClip,
    editorPlayhead,
    setEditorPlayhead,
    editorIsPlaying,
    setEditorIsPlaying,
    editorActiveClipIndex,
    setEditorActiveClipIndex,
    timelineZoom,
    setTimelineZoom,
    editorVideo,
    setEditorVideo,
    selectedClipId,
    setSelectedClipId,
    selectedClipIds,
    setSelectedClipIds,
    dragState,
    setDragState,
    trimState,
    setTrimState,
    playheadDrag,
    setPlayheadDrag,
    snapEnabled,
    setSnapEnabled,
    expandedTracks,
    setExpandedTracks,
    autoFollowPlayhead,
    setAutoFollowPlayhead,
    insertMode,
    setInsertMode,
    trackMeta,
    setTrackMeta,
    markers,
    setMarkers,
    loadVideoInEditor,
    clearEditorState,
    undo,
    redo,

    // Preview state
    previewCurrentTime,
    setPreviewCurrentTime,
    previewDuration,
    setPreviewDuration,
    previewIsPlaying,
    setPreviewIsPlaying,
  };
}

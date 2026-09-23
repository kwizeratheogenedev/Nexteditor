import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import API_BASE_URL, { API_ENDPOINTS } from './config';
import { useSocket } from './context/SocketContext';
import { EditorStateProvider } from './context/EditorStateContext';
import { useMediaState } from './hooks/useMediaState';
import { createSourceId, normalizeClip, createTextClip, createAudioClip, createAdjustmentClip, createImageClip } from './hooks/usePersistedEditorState';
import { useTimelinePlayer } from './timeline/useTimelinePlayer';
import { clipDuration, laneTotalDuration } from './timeline/transitions';
import { isVideoLikeClip, laneTypeForClip } from './timeline/clipKinds';
import { applyMotionPreset, DEFAULT_IMAGE_MOTION_PRESET_ID } from './timeline/motionPresets';
import { buildLongMixTimeline } from './timeline/longMix';
import { buildExportFormData, postExportRequest, pollExportProgress, downloadExportResult, exportResultStatus, exportResultUrl } from './timeline/exportRequest';
import { usePersistedLongMixState } from './hooks/usePersistedLongMixState';
import { buildCanvasSize } from './timeline/canvasPresets';
import TopBar from './components/TopBar';
import LeftSidebar from './components/LeftSidebar';
import CenterPanel from './components/CenterPanel';
import RightPanel from './components/RightPanel';
import ErrorPopup from './components/ErrorPopup';
import ProjectsModal from './components/ProjectsModal';
import JobsResumeBanner from './components/JobsResumeBanner';
import MontageTab from './components/MontageTab';
import BottomTimeline, { PX_PER_SECOND, laneHeight } from './components/BottomTimeline';

const VALID_TABS = ['media', 'captions', 'shorts', 'longmix', 'editor'];

// A long mix is a music video, not motion footage - 30fps is plenty and
// halves the render time against 60. The user picks the frame size in the
// panel; the frame rate isn't worth a control of its own here.
const LONGMIX_FPS = 30;

// How long a still image stays on screen when it's dropped onto the
// timeline by hand - an image has no duration of its own, so this is just a
// starting point to drag out or trim back like any other clip.
const DEFAULT_IMAGE_CLIP_SECONDS = 5;

function revokeObjectUrlIfNeeded(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

async function readErrorMessage(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json();
    return data?.error || 'Request failed';
  }

  return response.text();
}

function App() {
  // Use the unified media state hook
  const mediaState = useMediaState();
  const { socket, socketId } = useSocket();

  // Destructure commonly used state for cleaner code
  const {
    activeTab,
    setActiveTab,
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
    audioState,
    setAudioState,
    audioMeta,
    setAudioMeta,
    captionVideoState,
    setCaptionVideoState,
    captionVideoMeta,
    setCaptionVideoMeta,
    captionFileState,
    setCaptionFileState,
    captionFileMeta,
    setCaptionFileMeta,
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
    editorCanvasSize,
    setEditorCanvasSize,
    editorVideo,
    loadVideoInEditor,
    clearEditorState,
    undo,
    redo,
    currentProjectId,
    projectName,
    projectSyncStatus,
    saveProjectToAccount,
    loadProjectFromAccount,
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
    previewCurrentTime,
    setPreviewCurrentTime,
    previewDuration,
    setPreviewDuration,
    previewIsPlaying,
    setPreviewIsPlaying,
  } = mediaState;

  const [projectsModalOpen, setProjectsModalOpen] = useState(false);

  // LongMix Studio (the songs/scenes/settings the wizard is collecting, and
  // whatever render is or was in flight) - persisted across a reload or
  // navigating away, same as the Editor and Montage tabs already are (see
  // hooks/usePersistedLongMixState.js), since a mix here can legitimately
  // take hours and losing the wizard's picks - or the render itself - to an
  // accidental refresh is exactly the bad UX this exists to avoid.
  const {
    songs: longMixSongs,
    setSongs: setLongMixSongs,
    scenes: longMixScenes,
    setScenes: setLongMixScenes,
    settings: longMixSettings,
    setSettings: setLongMixSettings,
    building: longMixBuilding,
    setBuilding: setLongMixBuilding,
    jobId: longMixJobId,
    setJobId: setLongMixJobId,
    result: longMixResult,
    setResult: setLongMixResult,
    restored: longMixRestored,
  } = usePersistedLongMixState();

  const video1Ref = useRef(null);
  const video2Ref = useRef(null);
  const video3Ref = useRef(null);
  const audioRef = useRef(null);
  const captionVideoRef = useRef(null);
  const captionRef = useRef(null);
  const shortsVideoRef = useRef(null);

  // Mirrors activeTab for use inside async handlers/intervals that started on
  // one tab but may still be running after the user switches away - lets
  // them stop overwriting whichever tab is now visible with stale progress.
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const editorCanvasRef = useRef(null);
  const editorFileInputRef = useRef(null);
  const audioFileInputRef = useRef(null);
  const editorTimelineRef = useRef([]);
  // Copy/paste clipboard (M11) - a plain ref, not React state, since it
  // doesn't need to trigger a re-render and should survive across renders
  // exactly like a real OS clipboard would within the session.
  const editorClipboardRef = useRef([]);
  const previewVideoRef = useRef(null);

  // trackMeta (from usePersistedEditorState, persisted alongside the
  // timeline) is one {locked,hidden,name} entry per lane, per media type -
  // its array length IS the lane count, so "+ Add track" just appends a
  // default entry and "remove" splices one out (reindexing any clips on
  // lanes after it - see handleRemoveTrack below).
  const handleAddTrack = (type) => {
    setTrackMeta((prev) => ({ ...prev, [type]: [...prev[type], { locked: false, hidden: false, name: null }] }));
  };

  const handleToggleTrackLock = (type, laneIndex) => {
    setTrackMeta((prev) => ({
      ...prev,
      [type]: prev[type].map((lane, i) => (i === laneIndex ? { ...lane, locked: !lane.locked } : lane)),
    }));
  };
  const handleToggleTrackHidden = (type, laneIndex) => {
    setTrackMeta((prev) => ({
      ...prev,
      [type]: prev[type].map((lane, i) => (i === laneIndex ? { ...lane, hidden: !lane.hidden } : lane)),
    }));
  };
  const handleRenameTrack = (type, laneIndex, name) => {
    setTrackMeta((prev) => ({
      ...prev,
      [type]: prev[type].map((lane, i) => (i === laneIndex ? { ...lane, name: name.trim() || null } : lane)),
    }));
  };

  // Removing a lane deletes whatever clips are on it (revoking their blob
  // URLs, same cleanup handleEditorDelete already does) and shifts every
  // later lane's clips down one trackIndex to close the gap - refusing to
  // remove the last remaining lane of a type keeps at least one lane always
  // present, matching BottomTimeline always rendering at least one row.
  const handleRemoveTrack = (type, laneIndex) => {
    if (trackMeta[type].length <= 1) return;
    commitEditorTimeline((prev) => {
      const survivors = [];
      prev.forEach((clip) => {
        const clipType = laneTypeForClip(clip);
        if (clipType !== type) {
          survivors.push(clip);
          return;
        }
        const idx = clip.trackIndex || 0;
        if (idx === laneIndex) {
          revokeObjectUrlIfNeeded(clip.url);
          return;
        }
        survivors.push(idx > laneIndex ? { ...clip, trackIndex: idx - 1 } : clip);
      });
      return survivors;
    });
    setTrackMeta((prev) => ({ ...prev, [type]: prev[type].filter((_, i) => i !== laneIndex) }));
  };

  // Swaps two adjacent lanes' z-order (video) / organizational order
  // (audio/text) - both the lane metadata and every affected clip's
  // trackIndex swap together so content stays on "its" lane.
  const handleReorderTrack = (type, laneIndex, direction) => {
    const targetIndex = laneIndex + direction;
    if (targetIndex < 0 || targetIndex >= trackMeta[type].length) return;
    commitEditorTimeline((prev) => prev.map((clip) => {
      const clipType = laneTypeForClip(clip);
      if (clipType !== type) return clip;
      const idx = clip.trackIndex || 0;
      if (idx === laneIndex) return { ...clip, trackIndex: targetIndex };
      if (idx === targetIndex) return { ...clip, trackIndex: laneIndex };
      return clip;
    }));
    setTrackMeta((prev) => {
      const lanes = [...prev[type]];
      [lanes[laneIndex], lanes[targetIndex]] = [lanes[targetIndex], lanes[laneIndex]];
      return { ...prev, [type]: lanes };
    });
  };

  // Adjustment layers (M13) live on video lanes for z-order purposes (see
  // createAdjustmentClip) so they're grouped/rendered alongside real video
  // clips here.
  const editorVideoClips = useMemo(
    () => editorTimeline.filter((clip) => isVideoLikeClip(clip) || clip.type === 'adjustment'),
    [editorTimeline],
  );

  const editorAudioClips = useMemo(
    () => editorTimeline.filter((clip) => clip.type === 'audio'),
    [editorTimeline],
  );

  const editorTextClips = useMemo(
    () => editorTimeline.filter((clip) => clip.type === 'text'),
    [editorTimeline],
  );

  // Only trackIndex 0 renders in preview/export today (see
  // useTimelinePlayer.js/backend index.js) - that lane is the "main
  // program" whose length drives the transport bar and export duration.
  // Additional lanes are real and freely positioned but inert until M8's
  // multi-lane compositing lands.
  const editorLaneZeroVideoClips = useMemo(
    // Adjustment layers never define "the program" - only real base video
    // does, same reasoning that already excludes text/audio clips here.
    () => editorVideoClips.filter((clip) => (clip.trackIndex || 0) === 0 && clip.type !== 'adjustment'),
    [editorVideoClips],
  );
  const editorTotalDuration = useMemo(
    () => laneTotalDuration(editorLaneZeroVideoClips, clipDuration),
    [editorLaneZeroVideoClips],
  );
  // The ruler/timeline UI itself should show the full extent of every lane
  // (so overlay-track content isn't scrolled off/invisible), even though
  // only lane 0 currently plays back.
  const editorFullExtentDuration = useMemo(
    () => laneTotalDuration([...editorVideoClips, ...editorAudioClips, ...editorTextClips], clipDuration),
    [editorVideoClips, editorAudioClips, editorTextClips],
  );

  // Groups a media type's clips into lanes by trackIndex (sorted by
  // startTime within each lane), padded up to `minLaneCount` so a lane the
  // user added via "+ Add track" still renders even before any clip lands
  // on it.
  const buildLanes = useCallback((clips, minLaneCount) => {
    const maxIndex = clips.reduce((max, clip) => Math.max(max, clip.trackIndex || 0), -1);
    const laneCount = Math.max(minLaneCount, maxIndex + 1, 1);
    const lanes = Array.from({ length: laneCount }, () => []);
    clips.forEach((clip) => {
      const index = Math.min(clip.trackIndex || 0, laneCount - 1);
      lanes[index].push(clip);
    });
    lanes.forEach((lane) => lane.sort((a, b) => a.startTime - b.startTime));
    return lanes;
  }, []);

  const timelineTracks = useMemo(() => {
    if (activeTab === 'editor') {
      const toDisplay = (prefix) => (clip, index) => ({
        id: clip.id,
        label: clip.type === 'text'
          ? (clip.text?.content || `${prefix} ${index + 1}`)
          : clip.type === 'adjustment'
            ? 'Adjustment'
            : (clip.file?.name || `${prefix} ${index + 1}`),
        startTime: clip.startTime,
        duration: clipDuration(clip),
        type: clip.type || 'video',
        // Carried through (beyond the label/position fields the timeline
        // itself needs) so BottomTimeline's waveform/thumbnail rendering can
        // resolve and cache the clip's actual source media.
        sourceId: clip.sourceId,
        trimmedStart: clip.trimmedStart,
        trimmedEnd: clip.trimmedEnd,
        file: clip.file,
        url: clip.url,
        remoteUrl: clip.remoteUrl,
        color: clip.color,
      });
      return {
        video: buildLanes(editorVideoClips, trackMeta.video.length).map((lane) => lane.map(toDisplay('Clip'))),
        audio: buildLanes(editorAudioClips, trackMeta.audio.length).map((lane) => lane.map(toDisplay('Audio'))),
        text: buildLanes(editorTextClips, trackMeta.text.length).map((lane) => lane.map(toDisplay('Text'))),
      };
    }

    const videoClips = [];
    const audioClips = [];
    const textClips = [];

    if (activeTab === 'media') {
      [video1State, video2State, video3State].forEach((state, index) => {
        if (!state || !(state.status === 'ready' || state.file)) return;
        videoClips.push({
          id: `media-${index}`,
          label: state.fileName || state.file?.name || `Video ${index + 1}`,
          duration: state.duration || 8,
          type: 'video',
        });
      });
      if (audioState && (audioState.status === 'ready' || audioState.file)) {
        audioClips.push({
          id: 'media-audio',
          label: audioState.fileName || audioState.file?.name || 'Audio',
          duration: audioState.duration || 16,
          type: 'audio',
        });
      }
    }

    if (activeTab === 'captions') {
      if (captionVideoState && (captionVideoState.status === 'ready' || captionVideoState.file)) {
        videoClips.push({
          id: 'caption-video',
          label: captionVideoState.fileName || captionVideoState.file?.name || 'Caption Video',
          duration: captionVideoState.duration || 12,
          type: 'video',
        });
      }
      if (captionFileState && (captionFileState.status === 'ready' || captionFileState.file)) {
        textClips.push({
          id: 'caption-text',
          label: captionFileState.fileName || captionFileState.file?.name || 'Caption Text',
          duration: captionFileState.duration || 10,
          type: 'text',
        });
      }
    }

    if (activeTab === 'shorts') {
      if (shortsVideoState && (shortsVideoState.status === 'ready' || shortsVideoState.file)) {
        videoClips.push({
          id: 'short-source',
          label: shortsVideoState.fileName || shortsVideoState.file?.name || 'Short Source',
          duration: shortsVideoState.duration || 18,
          type: 'video',
        });
      }
      shortsResults?.forEach((clip, index) => {
        videoClips.push({
          id: clip.id,
          label: `Short ${index + 1}`,
          duration: clip.duration || 8,
          type: 'video',
        });
      });
    }

    // Non-editor tabs never have more than one lane per type - wrap each in
    // a single-lane array to match the editor tab's lanes-of-lanes shape.
    return {
      video: [videoClips],
      audio: [audioClips],
      text: [textClips],
    };
  }, [activeTab, audioMeta, captionFileMeta, captionVideoMeta, editorTimeline, shortsResults, shortsVideoMeta, video1Meta, video2Meta, video3Meta, video1State, video2State, video3State, audioState, captionVideoState, captionFileState, shortsVideoState, trackMeta, buildLanes, editorVideoClips, editorAudioClips, editorTextClips]);

  // Per-lane display labels for the non-editor tabs (which only ever show a
  // single lane per type) - the editor tab doesn't pass laneLabels at all,
  // letting BottomTimeline fall back to generic "Video 1"/"Video 2" naming
  // since multi-lane editor content has no one obvious representative name.
  const laneLabels = useMemo(() => {
    if (activeTab === 'editor') {
      // `null` entries fall through to BottomTimeline's generic "Video N"
      // fallback naming - only lanes the user explicitly renamed carry a
      // real string here.
      return {
        video: trackMeta.video.map((lane) => lane.name),
        audio: trackMeta.audio.map((lane) => lane.name),
        text: trackMeta.text.map((lane) => lane.name),
      };
    }
    const videoNames = timelineTracks.video[0]?.map((c) => c.label).filter(Boolean) || [];
    const audioNames = timelineTracks.audio[0]?.map((c) => c.label).filter(Boolean) || [];
    const textNames = timelineTracks.text[0]?.map((c) => c.label).filter(Boolean) || [];
    return {
      video: [videoNames[0] || 'Video'],
      audio: [audioNames[0] || 'Audio'],
      text: [textNames[0] || 'Text'],
    };
  }, [activeTab, timelineTracks, trackMeta]);

  const effectiveTimelineDuration = activeTab === 'editor'
    ? Math.max(editorFullExtentDuration, 32)
    : Math.max(
        32,
        (timelineTracks.video[0] || []).reduce((acc, clip) => acc + clip.duration, 0),
        (timelineTracks.audio[0] || []).reduce((acc, clip) => acc + clip.duration, 0),
        (timelineTracks.text[0] || []).reduce((acc, clip) => acc + clip.duration, 0),
      );

  // Right-click-a-gap "Close Gap" affordance (M10) - null when no menu is
  // showing, otherwise the lane/gap the user right-clicked plus the screen
  // position to render the menu at.
  const [gapMenu, setGapMenu] = useState(null);

  const [timelineHeight, setTimelineHeight] = useState(() => {
    try {
      const stored = localStorage.getItem('nexeditor_timeline_height');
      return stored ? Number(stored) : 238;
    } catch {
      return 238;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('nexeditor_timeline_height', String(timelineHeight));
    } catch {
      // ignore storage errors
    }
  }, [timelineHeight]);

  useEffect(() => {
    const hasPreviousFiles = video1Meta || video2Meta || video3Meta || audioMeta || captionVideoMeta || captionFileMeta || shortsVideoMeta;
    if (hasPreviousFiles) {
      setErrorText('Welcome back! Please re-upload your files to continue where you left off.');
    }
  }, []);

  useEffect(() => {
    if (!errorText) {
      return undefined;
    }

    const timer = window.setTimeout(() => setErrorText(null), 6000);
    return () => window.clearTimeout(timer);
  }, [errorText]);

  // Corrects a wildly mismatched zoom (e.g. left over from a previous,
  // very differently-sized project) back toward a sane "fit" level - but
  // only when the CONTENT DURATION itself changes, not on every zoom
  // change. timelineZoom is deliberately not a dependency (read via a
  // functional update instead): including it would re-run this on every
  // zoom tick and fight the user's own zoom-in clicks the moment they
  // passed 1.5x "fit", which is exactly backwards - zooming in past the
  // fit level to do precise trims is the normal, expected use of zoom.
  useEffect(() => {
    if (activeTab !== 'editor') return;
    const total = effectiveTimelineDuration;
    if (!total || total <= 0) return;

    const containerWidth = 1100;
    const targetMaxWidth = containerWidth * 0.9;
    const autoZoom = Math.max(10, Math.min(400, Math.floor((targetMaxWidth / (total * PX_PER_SECOND)) * 100)));

    setTimelineZoom((currentZoom) => (
      currentZoom > autoZoom * 1.5 || currentZoom < autoZoom * 0.5 ? autoZoom : currentZoom
    ));
  }, [activeTab, effectiveTimelineDuration, setTimelineZoom]);

  useEffect(() => {
    if (!VALID_TABS.includes(activeTab)) {
      setActiveTab('editor');
    }
  }, [activeTab, setActiveTab]);

  // A `montageSession` URL param means this tab was opened via MontageTab's
  // "Create another montage" button - land on the Montage tab explicitly
  // rather than relying on whatever tab was last active (normally the same
  // one, since the button only shows while already on Montage, but this
  // keeps the new tab's landing spot correct even if that assumption ever
  // breaks - e.g. activeTab is shared, unnamespaced localStorage).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('montageSession')) {
      setActiveTab('media');
    }
  }, [setActiveTab]);

  useEffect(() => {
    if (!dragState.active) return;
    window.addEventListener('mouseup', handleClipDragEnd);
    return () => {
      window.removeEventListener('mouseup', handleClipDragEnd);
    };
  }, [dragState.active]);

  useEffect(() => {
    if (!trimState.active) return;
    window.addEventListener('mousemove', handleTrimDragMove);
    window.addEventListener('mouseup', handleTrimDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleTrimDragMove);
      window.removeEventListener('mouseup', handleTrimDragEnd);
    };
  }, [trimState.active]);

  useEffect(() => {
    if (!playheadDrag) return;
    window.addEventListener('mousemove', handlePlayheadDragMove);
    window.addEventListener('mouseup', handlePlayheadDragEnd);
    return () => {
      window.removeEventListener('mousemove', handlePlayheadDragMove);
      window.removeEventListener('mouseup', handlePlayheadDragEnd);
    };
  }, [playheadDrag]);

  // Listen for ffmpeg progress updates
  useEffect(() => {
    if (!socket) return;

    socket.on('ffmpeg-progress', (payload) => {
      // 'ffmpeg-progress' is emitted by both the Captions and Shorts backend
      // routes with no feature tag; only reflect it while a tab that could
      // plausibly own it is visible, so a lingering job from a tab the user
      // left doesn't overwrite whatever they're looking at now.
      if (activeTabRef.current !== 'captions' && activeTabRef.current !== 'shorts') return;
      setProgress({
        percent: payload?.percent || 0,
        currentTime: payload?.currentTime || '',
      });
    });

    socket.on('export-progress', (payload) => {
      if (activeTabRef.current !== 'editor') return;
      setProgress({
        percent: payload?.percent || 0,
        currentTime: payload?.currentTime || '',
      });
    });

    return () => {
      socket.off('ffmpeg-progress');
      socket.off('export-progress');
    };
  }, [socket, setProgress]);

  useEffect(() => {
    if (!shortsResults?.length) {
      setSelectedShortId(null);
      return;
    }

    const selectedExists = shortsResults.some((clip) => clip.id === selectedShortId);
    if (!selectedExists) {
      setSelectedShortId(shortsResults[0].id);
    }
  }, [selectedShortId, shortsResults]);

  useEffect(() => {
    editorTimelineRef.current = editorTimeline;
  }, [editorTimeline]);

  useEffect(() => () => {
    editorTimelineRef.current.forEach((clip) => {
      revokeObjectUrlIfNeeded(clip.url);
    });
  }, []);

  useEffect(() => {
    if (!editorVideo?.fileName) {
      return undefined;
    }

    const remoteUrl = `${API_BASE_URL}/clips/${editorVideo.fileName}`;
    const tempVideo = document.createElement('video');

    const handleLoadedMetadata = () => {
      commitEditorTimeline((previous) => {
        previous.forEach((clip) => revokeObjectUrlIfNeeded(clip.url));
        return [
          normalizeClip({
            id: `montage-${Date.now()}`,
            sourceId: createSourceId(),
            file: { name: editorVideo.fileName },
            url: remoteUrl,
            duration: tempVideo.duration,
            trimmedStart: 0,
            trimmedEnd: tempVideo.duration,
          }),
        ];
      });
      setEditorPlayhead(0);
      setEditorActiveClipIndex(0);
      setEditorIsPlaying(false);
    };

    const handleError = () => {
      setErrorText('Unable to load the generated montage into the editor.');
    };

    tempVideo.addEventListener('loadedmetadata', handleLoadedMetadata);
    tempVideo.addEventListener('error', handleError);
    tempVideo.src = remoteUrl;

    return () => {
      tempVideo.removeEventListener('loadedmetadata', handleLoadedMetadata);
      tempVideo.removeEventListener('error', handleError);
    };
  }, [editorVideo, setEditorActiveClipIndex, setEditorIsPlaying, setEditorPlayhead, setEditorTimeline, setErrorText]);

  const storeFileMeta = (file, setter, metaSetter) => {
    if (!file) {
      return;
    }

    setter((current) => ({
      ...(current && !(current instanceof File) ? current : {}),
      sourceMode: 'device',
      file,
      fileName: file.name,
      status: 'ready',
      progress: 100,
      error: '',
    }));
    metaSetter({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });
  };

  const handleVideoSelect = (event, setter, metaSetter, fieldName) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('video/')) {
      setErrorText(`Oops! You selected a non-video file for ${fieldName}. Please upload a valid VIDEO file.`);
      event.target.value = '';
      setter(null);
      metaSetter(null);
      return;
    }

    storeFileMeta(file, setter, metaSetter);
    setErrorText(null);
  };

  const handleAudioSelect = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('audio/')) {
      setErrorText('Oops! Please upload a valid AUDIO file for the Soundtrack.');
      event.target.value = '';
      setAudioState(null);
      setAudioMeta(null);
      return;
    }

    storeFileMeta(file, setAudioState, setAudioMeta);
    setErrorText(null);
  };

  const handleCaptionSelect = (event, isVideo) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    if (isVideo) {
      if (!file.type.startsWith('video/')) {
        setErrorText('Please upload a valid video file.');
        event.target.value = '';
        setCaptionVideoState(null);
        setCaptionVideoMeta(null);
        return;
      }
      storeFileMeta(file, setCaptionVideoState, setCaptionVideoMeta);
    } else {
      if (!file.name.endsWith('.srt') && !file.name.endsWith('.vtt')) {
        setErrorText('Oops! Please upload a valid .srt or .vtt subtitle file.');
        event.target.value = '';
        setCaptionFileState(null);
        setCaptionFileMeta(null);
        return;
      }
      storeFileMeta(file, setCaptionFileState, setCaptionFileMeta);
    }

    setErrorText(null);
  };

  /**
   * Handle successful URL video fetch
   * Stores the fetched file metadata in the appropriate video/audio state
   */
  const handleUrlVideoFetched = (data, setter, metaSetter, fieldName) => {
    if (!data.filePath || !data.fileName) {
      setErrorText(`Failed to fetch ${fieldName}: Missing file information`);
      return;
    }

    // Create a virtual File-like object with metadata
    const fetchedFileMeta = {
      name: data.fileName || `fetched-video-${Date.now()}`,
      size: 0, // Size unknown from remote fetch, will be calculated later if needed
      type: 'video/mp4', // Assume mp4 from yt-dlp or inferred
      lastModified: Date.now(),
      filePath: data.filePath, // Backend file path for reference
      source: 'url-fetch',
      sourcePath: data.type, // 'youtube', 'gdrive', 'dropbox', 'direct'
    };

    setter(null); // Clear file object (we don't need it for backend fetched files)
    metaSetter(fetchedFileMeta);
    setErrorText(null);
  };

  /**
   * Create URL fetch handlers for each video track
   */
  const handleVideo1UrlFetch = (data) => {
    handleUrlVideoFetched(data, setVideo1State, setVideo1Meta, 'Video 1');
  };

  const handleVideo2UrlFetch = (data) => {
    handleUrlVideoFetched(data, setVideo2State, setVideo2Meta, 'Video 2');
  };

  const handleVideo3UrlFetch = (data) => {
    handleUrlVideoFetched(data, setVideo3State, setVideo3Meta, 'Video 3');
  };

  const handleAudioUrlFetch = (data) => {
    handleUrlVideoFetched(data, setAudioState, setAudioMeta, 'Audio');
  };

  const handleCaptionVideoUrlFetch = (data) => {
    handleUrlVideoFetched(data, setCaptionVideoState, setCaptionVideoMeta, 'Caption Video');
  };

  const handleShortsVideoUrlFetch = (data) => {
    handleUrlVideoFetched(data, setShortsVideoState, setShortsVideoMeta, 'Shorts Video');
  };


  const handleMontageConvert = async () => {
    // Check if all 3 videos have files or filePaths (from URL fetch)
    const hasVideo1 = video1State.status === 'ready' && (video1State.file || video1State.filePath);
    const hasVideo2 = video2State.status === 'ready' && (video2State.file || video2State.filePath);
    const hasVideo3 = video3State.status === 'ready' && (video3State.file || video3State.filePath);
    const hasAudio = audioState.status === 'ready' && (audioState.file || audioState.filePath);

    if (!hasVideo1 || !hasVideo2 || !hasVideo3 || !hasAudio) {
      setErrorText('Please provide all 3 video tracks and 1 audio track before exporting a Montage.');
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setResultUrl(null);
    setResultTab(null);
    setProgress({ percent: 0, currentTime: 'Preparing files...' });

    const formData = new FormData();
    
    // Determine source mode based on whether files are from URL fetch (filePath) or local upload (file)
    const isUrlMode = Boolean(video1State.filePath && video2State.filePath && video3State.filePath && audioState.filePath);
    
    if (isUrlMode) {
      // Use file paths from URL fetch
      formData.append('videoSourceMode', 'path');
      formData.append('video1Path', video1State.filePath);
      formData.append('video2Path', video2State.filePath);
      formData.append('video3Path', video3State.filePath);
      formData.append('audioPath', audioState.filePath);
    } else {
      // Use file objects from local uploads
      formData.append('videoSourceMode', 'upload');
      if (video1State.file) formData.append('video1', video1State.file);
      if (video2State.file) formData.append('video2', video2State.file);
      if (video3State.file) formData.append('video3', video3State.file);
      if (audioState.file) formData.append('audio', audioState.file);
    }

    try {
      setProgress({ percent: 0, currentTime: 'Starting merge...' });
      
      const response = await fetch(API_ENDPOINTS.convert, {
        method: 'POST',
        headers: socketId ? { 'X-Socket-Id': socketId } : {},
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || await readErrorMessage(response));
      }

      // Get the blob - could be video or error JSON
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Merge failed - unknown error');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      setResultTab('media');
      setProgress({ percent: 100, currentTime: 'Complete!' });
    } catch (error) {
      console.error('Montage error:', error);
      setErrorText(error.message || 'Error generating montage');
      setProgress({ percent: 0, currentTime: '' });
    } finally {
      setProcessing(false);
    }
  };

  const handleCaptionConvert = async (mode = 'local', options = {}) => {
    const isAutomatic = mode === 'auto' || mode === 'lyrics';
    if (!captionVideoState?.file || (!isAutomatic && !captionFileState?.file)) {
      setErrorText(isAutomatic ? 'Please upload a video to generate captions.' : 'Please upload exactly 1 Video and 1 Subtitle file.');
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setResultUrl(null);
    setResultTab(null);
    setProgress({ percent: 0, currentTime: '' });

    const formData = new FormData();
    formData.append("video", captionVideoState.file);
    if (!isAutomatic) formData.append("subtitle", captionFileState.file);
    if (isAutomatic) {
      formData.append('mode', mode);
      formData.append('language', options.language || 'English (US)');
      formData.append('removeFillers', String(Boolean(options.removeFillers)));
    }
    formData.append('captionPosition', options.captionPosition || 'bottom');

    try {
      const blob = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const progressEndpoint = isAutomatic ? API_ENDPOINTS.generateCaptions : API_ENDPOINTS.burnSubtitles;
        let progressTimer;
        request.open('POST', progressEndpoint);
        request.responseType = 'blob';
        if (socketId) request.setRequestHeader('X-Socket-Id', socketId);
        request.setRequestHeader('X-Job-Id', jobId);
        request.upload.onprogress = (event) => {
          if (!event.lengthComputable || activeTabRef.current !== 'captions') return;
          const uploadPercent = Math.max(1, Math.min(10, (event.loaded / event.total) * 10));
          setProgress({ percent: uploadPercent, currentTime: `Uploading video ${Math.round((event.loaded / event.total) * 100)}%...` });
        };
        progressTimer = setInterval(async () => {
          try {
            const response = await fetch(`${progressEndpoint}/progress/${jobId}`, { cache: 'no-store' });
            if (!response.ok || activeTabRef.current !== 'captions') return;
            const status = await response.json();
            if (status.percent > 10 || status.currentTime !== 'Waiting for upload...') setProgress(status);
          } catch { /* socket progress remains available */ }
        }, 750);
        request.onerror = () => {
          clearInterval(progressTimer);
          reject(new Error('Unable to reach the caption server.'));
        };
        request.onload = async () => {
          clearInterval(progressTimer);
          if (request.status >= 200 && request.status < 300) {
            resolve(request.response);
            return;
          }
          let message = `Caption generation failed (${request.status})`;
          try {
            const payload = JSON.parse(await request.response.text());
            message = payload.error || message;
          } catch { /* response was not JSON */ }
          reject(new Error(message));
        };
        request.send(formData);
      });
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      setResultTab('captions');
      setProgress({ percent: 100, currentTime: 'Captioned video ready' });
    } catch (error) {
      console.error(error);
      setErrorText(error.message || 'Error burning subtitles');
    } finally {
      setProcessing(false);
    }
  };

  const handleShortsConvert = async () => {
    if (!shortsVideoState.file) {
      setErrorText('Please upload a long-form video to extract shorts.');
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setShortsResults(null);
    setResultUrl(null);
    setProgress({ percent: 0, currentTime: '' });

    const formData = new FormData();
    formData.append("video", shortsVideoState.file);
    formData.append('duration', shortsDuration);
    formData.append('aspectRatio', shortsFormat);

    try {
      const data = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        let progressTimer;
        request.open('POST', API_ENDPOINTS.extractShorts);
        request.responseType = 'json';
        request.setRequestHeader('X-Job-Id', jobId);
        if (socketId) request.setRequestHeader('X-Socket-Id', socketId);
        request.upload.onprogress = (event) => {
          if (!event.lengthComputable || activeTabRef.current !== 'shorts') return;
          const percent = event.loaded / event.total;
          setProgress({ percent: Math.max(1, percent * 10), currentTime: `Uploading source video ${Math.round(percent * 100)}%...` });
        };
        progressTimer = setInterval(async () => {
          try {
            const response = await fetch(`${API_ENDPOINTS.extractShorts}/progress/${jobId}`, { cache: 'no-store' });
            if (!response.ok || activeTabRef.current !== 'shorts') return;
            const status = await response.json();
            if (status.percent > 10 || status.currentTime !== 'Waiting for upload...') setProgress(status);
          } catch { /* socket updates remain available */ }
        }, 750);
        request.onerror = () => {
          clearInterval(progressTimer);
          reject(new Error('Unable to reach the shorts server.'));
        };
        request.onload = () => {
          clearInterval(progressTimer);
          if (request.status >= 200 && request.status < 300) resolve(request.response);
          else reject(new Error(request.response?.error || `Shorts generation failed (${request.status})`));
        };
        request.send(formData);
      });
      setShortsResults(data.shorts);
      setProgress({ percent: 100, currentTime: `${data.shorts.length} shorts ready` });
    } catch (error) {
      console.error(error);
      setErrorText(error.message || 'Error extracting shorts');
    } finally {
      setProcessing(false);
    }
  };

  const handleReformat = async (clipData, formatStrategy) => {
    try {
      setProcessing(true);
      setProgress({ percent: 0, currentTime: '' });

      const response = await fetch(API_ENDPOINTS.reformatShort, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(socketId ? { 'X-Socket-Id': socketId } : {}),
        },
        body: JSON.stringify({
          jobId: clipData.jobId,
          startTime: clipData.startTime,
          duration: clipData.duration,
          formatStrategy,
          aspectRatio: clipData.aspectRatio,
          id: clipData.id,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = await response.json();
      setShortsResults((previous) => previous.map((clip) => (clip.id === clipData.id ? data : clip)));
      setSelectedShortId(data.id);
    } catch (error) {
      setErrorText(error.message || 'Failed to reformat clip');
    } finally {
      setProcessing(false);
    }
  };

  const handleShortDownload = async (clip, index) => {
    try {
      const response = await fetch(clip.url);
      if (!response.ok) {
        throw new Error('Failed to download clip');
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `NexEditor_Short_${index + 1}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error(error);
      setErrorText(error.message || 'Failed to download clip');
    }
  };

  const handleReset = (clearStorage = true) => {
    if (activeTab === 'media') {
      setVideo1State(null);
      setVideo2State(null);
      setVideo3State(null);
      setAudioState(null);
      // setVideoSourceMode - not available in new state



      if (clearStorage) {
        setVideo1Meta(null);
        setVideo2Meta(null);
        setVideo3Meta(null);
        setAudioMeta(null);
      }
      if (video1Ref.current) video1Ref.current.value = '';
      if (video2Ref.current) video2Ref.current.value = '';
      if (video3Ref.current) video3Ref.current.value = '';
      if (audioRef.current) audioRef.current.value = '';
    } else if (activeTab === 'captions') {
      setCaptionVideoState(null);
      setCaptionFileState(null);
      if (clearStorage) {
        setCaptionVideoMeta(null);
        setCaptionFileMeta(null);
      }
      if (captionVideoRef.current) captionVideoRef.current.value = '';
      if (captionRef.current) captionRef.current.value = '';
    } else if (activeTab === 'shorts') {
      setShortsVideoState(null);
      if (clearStorage) {
        setShortsVideoMeta(null);
      }
      if (shortsVideoRef.current) shortsVideoRef.current.value = '';
      setShortsResults(null);
      setSelectedShortId(null);
    } else if (activeTab === 'editor') {
      clearEditorState();
      if (editorFileInputRef.current) {
        editorFileInputRef.current.value = '';
      }
    }

    setResultUrl(null);
    setResultTab(null);
    setProgress({ percent: 0, currentTime: '' });
    if (clearStorage) {
      setErrorText(null);
    }
  };

  // Shared by the main "+ Import" button (handleEditorUpload, below) and the
  // audio track's own "+ Add audio" button (handleAudioUpload) - probes
  // duration via a real <audio> element (a <video> element's duration
  // read on a pure-audio file is unreliable across browsers) and appends to
  // the audio track, same positioning rule the text track uses.
  const addAudioFileToTimeline = (file) => {
    const url = URL.createObjectURL(file);
    const tempAudio = document.createElement('audio');
    tempAudio.preload = 'metadata';
    tempAudio.src = url;

    tempAudio.onloadedmetadata = () => {
      const duration = tempAudio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const laneZeroEnd = editorAudioClips
        .filter((clip) => (clip.trackIndex || 0) === 0)
        .reduce((max, clip) => Math.max(max, clip.startTime + clipDuration(clip)), 0);
      const clip = createAudioClip({
        sourceId: createSourceId(),
        file,
        url,
        trackIndex: 0,
        startTime: laneZeroEnd,
        trimmedStart: 0,
        trimmedEnd: duration,
      });
      commitEditorTimeline((prev) => [...prev, clip]);
      setSelectedClipId(clip.id);
      setSelectedClipIds([clip.id]);
    };

    tempAudio.load();
  };

  const addVideoFileToTimeline = (file) => {
    const url = URL.createObjectURL(file);
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.src = url;

    const finalizeClip = (duration) => {
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      commitEditorTimeline((previous) => {
        const existingClip = previous.find((clip) => clip.url === url);
        if (existingClip) {
          return previous.map((clip) =>
            clip.url === url
              ? {
                  ...clip,
                  duration,
                  trimmedStart: 0,
                  trimmedEnd: duration,
                }
              : clip,
          );
        }

        // Appends after whatever's already on lane 0 (the base/background
        // video track) - the common "import adds to the end" flow; the
        // clip can be freely dragged elsewhere (including onto a different
        // lane) afterward.
        const laneZeroEnd = previous
          .filter((clip) => isVideoLikeClip(clip) && (clip.trackIndex || 0) === 0)
          .reduce((max, clip) => Math.max(max, clip.startTime + (clip.trimmedEnd - clip.trimmedStart) / (clip.speed || 1)), 0);
        return [
          ...previous,
          normalizeClip({
            id: `${Date.now()}-${previous.length}`,
            sourceId: createSourceId(),
            file,
            url,
            duration,
            trackIndex: 0,
            startTime: laneZeroEnd,
            trimmedStart: 0,
            trimmedEnd: duration,
          }),
        ];
      });
    };

    tempVideo.onloadedmetadata = () => {
      const duration = tempVideo.duration;
      if (Number.isFinite(duration) && duration > 0) {
        finalizeClip(duration);
      }
    };

    tempVideo.onerror = () => {
      // If metadata loading fails, try to get duration from the playing video
      tempVideo.load();
    };

    tempVideo.load();
  };

  // A still image has no metadata to probe and no source duration to
  // respect - it goes straight onto the video track at a default length the
  // user can trim or extend like anything else. It lands with a slow camera
  // move already keyframed on (see timeline/motionPresets.js), because an
  // untouched still on a timeline otherwise reads as a frozen video; the
  // move is ordinary keyframes, so "None" in the inspector's Animate row
  // removes it.
  const addImageFileToTimeline = (file) => {
    const url = URL.createObjectURL(file);
    commitEditorTimeline((previous) => {
      const laneZeroEnd = previous
        .filter((clip) => isVideoLikeClip(clip) && (clip.trackIndex || 0) === 0)
        .reduce((max, clip) => Math.max(max, clip.startTime + clipDuration(clip)), 0);
      return [
        ...previous,
        createImageClip({
          sourceId: createSourceId(),
          file,
          url,
          trackIndex: 0,
          startTime: laneZeroEnd,
          duration: DEFAULT_IMAGE_CLIP_SECONDS,
          motionKeyframes: applyMotionPreset(
            { x: [], y: [], rotation: [], opacity: [], volume: [], speed: [], scaleX: [], scaleY: [] },
            DEFAULT_IMAGE_MOTION_PRESET_ID,
            DEFAULT_IMAGE_CLIP_SECONDS,
          ),
        }),
      ];
    });
  };

  // The main Import button accepts video, audio and images now - route by
  // the picked file's actual type instead of assuming everything is video,
  // so an audio file lands on the audio track and an image becomes a still
  // clip instead of being probed with a <video> element that would never
  // report a duration for it.
  const handleEditorUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    if (file.type.startsWith('audio/')) {
      addAudioFileToTimeline(file);
    } else if (file.type.startsWith('image/')) {
      addImageFileToTimeline(file);
    } else {
      addVideoFileToTimeline(file);
    }
    event.target.value = '';
  };

  // Splits whichever clip is under the playhead - now that every clip has
  // an absolute startTime this works uniformly for video/audio/text and any
  // lane, not just the base video track. Prefers the currently-selected
  // clip when it qualifies (so splitting a specific overlay clip that
  // happens to overlap another lane's clip in time is unambiguous),
  // otherwise picks the first match.
  const handleEditorSplit = () => {
    const qualifies = (clip) => editorPlayhead > clip.startTime && editorPlayhead < clip.startTime + clipDuration(clip);
    const selected = editorTimeline.find((clip) => clip.id === selectedClipId);
    const clipToSplit = (selected && qualifies(selected)) ? selected : editorTimeline.find(qualifies);
    if (!clipToSplit) return;

    const targetIndex = editorTimeline.findIndex((clip) => clip.id === clipToSplit.id);
    if (targetIndex === -1) return;

    const localOutputTime = editorPlayhead - clipToSplit.startTime;
    const splitPoint = clipToSplit.trimmedStart + localOutputTime * (clipToSplit.speed || 1);

    const leftClip = {
      ...clipToSplit,
      trimmedEnd: splitPoint,
      // The split itself is a hard cut - only the new tail piece (rightClip)
      // keeps whatever transition originally led into the clip that follows.
      transitionOut: null,
    };

    const rightClip = {
      ...clipToSplit,
      id: `${Date.now()}-${targetIndex + 1}`,
      trimmedStart: splitPoint,
      startTime: clipToSplit.startTime + localOutputTime,
    };

    const updatedTimeline = [...editorTimeline];
    updatedTimeline.splice(targetIndex, 1, leftClip, rightClip);
    commitEditorTimeline(updatedTimeline);
    setSelectedClipId(rightClip.id);
    setSelectedClipIds([rightClip.id]);
  };

  // Adjustment layers (M13) render inside video lanes (see
  // createAdjustmentClip) so a locked/hidden video lane's trackMeta is what
  // actually governs them, not a nonexistent 'adjustment' bucket.
  const trackMetaTypeFor = (clip) => laneTypeForClip(clip);
  const isClipLocked = (clip) => Boolean(trackMeta[trackMetaTypeFor(clip)]?.[clip.trackIndex || 0]?.locked);

  // Freeze frame: like Split, but the new gap between the two halves is
  // filled with a held copy of the exact frame under the playhead (see
  // backend/services/filterGraph/effects/trim.js's tpad-based hold, and
  // useTimelinePlayer.js's toEntry pinning localTime for clip.frozen) rather
  // than a hard cut - everything after the insertion point on the SAME lane
  // shifts forward to make room, matching insert-mode drag's scoping.
  const FREEZE_FRAME_DURATION = 2;
  const handleFreezeFrame = () => {
    const qualifies = (clip) => (clip.type === 'video' || !clip.type)
      && editorPlayhead > clip.startTime && editorPlayhead < clip.startTime + clipDuration(clip);
    const selected = editorTimeline.find((clip) => clip.id === selectedClipId);
    const clipToSplit = (selected && qualifies(selected)) ? selected : editorTimeline.find(qualifies);
    if (!clipToSplit || isClipLocked(clipToSplit)) return;

    const localOutputTime = editorPlayhead - clipToSplit.startTime;
    const splitPoint = clipToSplit.trimmedStart + localOutputTime * (clipToSplit.speed || 1);
    const freezeStartTime = clipToSplit.startTime + localOutputTime;
    const laneType = laneTypeForClip(clipToSplit);
    const laneIndex = clipToSplit.trackIndex || 0;

    const leftClip = { ...clipToSplit, trimmedEnd: splitPoint, transitionOut: null };
    const frozenClip = {
      ...clipToSplit,
      id: `${Date.now()}-freeze`,
      startTime: freezeStartTime,
      trimmedStart: splitPoint,
      trimmedEnd: splitPoint + FREEZE_FRAME_DURATION,
      frozen: true,
      muted: true,
      speed: 1,
      transitionOut: null,
      groupId: null,
    };
    const rightClip = {
      ...clipToSplit,
      id: `${Date.now()}-freeze-tail`,
      trimmedStart: splitPoint,
      startTime: freezeStartTime + FREEZE_FRAME_DURATION,
    };

    const rest = editorTimeline
      .filter((clip) => clip.id !== clipToSplit.id)
      .map((clip) => (
        laneTypeForClip(clip) === laneType && (clip.trackIndex || 0) === laneIndex && clip.startTime >= freezeStartTime
          ? { ...clip, startTime: clip.startTime + FREEZE_FRAME_DURATION }
          : clip
      ));

    commitEditorTimeline([...rest, leftClip, frozenClip, rightClip]);
    setSelectedClipId(frozenClip.id);
    setSelectedClipIds([frozenClip.id]);
  };

  const handleEditorDelete = () => {
    if (!editorTimeline.length) {
      return;
    }

    const requestedIds = selectedClipIds.length > 0 ? [...selectedClipIds] : [editorTimeline[editorActiveClipIndex]?.id].filter(Boolean);
    // A locked lane blocks edits to whatever's on it - same rule drag/trim
    // already enforce (BottomTimeline.jsx's ClipBlock skips onDragStart/
    // onTrimStart when locked).
    const idsToDelete = requestedIds.filter((id) => {
      const clip = editorTimeline.find((c) => c.id === id);
      return clip && !isClipLocked(clip);
    });
    if (!idsToDelete.length) return;
    const nextTimeline = editorTimeline.filter((clip) => !idsToDelete.includes(clip.id));
    idsToDelete.forEach((id) => {
      const clip = editorTimeline.find((c) => c.id === id);
      revokeObjectUrlIfNeeded(clip?.url);
    });
    commitEditorTimeline(nextTimeline);
    setSelectedClipIds([]);
    setSelectedClipId(null);
    setEditorActiveClipIndex(0);
    setEditorPlayhead(0);
  };

  // Ripple delete: same lock-respecting deletion as handleEditorDelete, but
  // every later clip *on the same lane* as a deleted clip shifts left to
  // close the gap - CapCut has no auto-ripple by default, so this is an
  // explicit alternate action (Shift+Delete / toolbar button) rather than
  // Delete's normal behavior, which leaves a gap in place.
  const handleEditorRippleDelete = () => {
    if (!editorTimeline.length) return;

    const requestedIds = selectedClipIds.length > 0 ? [...selectedClipIds] : [editorTimeline[editorActiveClipIndex]?.id].filter(Boolean);
    const idsToDelete = new Set(requestedIds.filter((id) => {
      const clip = editorTimeline.find((c) => c.id === id);
      return clip && !isClipLocked(clip);
    }));
    if (!idsToDelete.size) return;

    const deletedClips = editorTimeline.filter((clip) => idsToDelete.has(clip.id));
    const survivors = editorTimeline.filter((clip) => !idsToDelete.has(clip.id));
    const nextTimeline = survivors.map((clip) => {
      const clipType = laneTypeForClip(clip);
      const clipLane = clip.trackIndex || 0;
      // Only clips deleted from the SAME lane (type + trackIndex) affect
      // this survivor - shift left by the combined duration of every
      // deleted clip on that lane that started before it.
      const shift = deletedClips.reduce((sum, deleted) => {
        const deletedType = laneTypeForClip(deleted);
        const deletedLane = deleted.trackIndex || 0;
        if (deletedType !== clipType || deletedLane !== clipLane) return sum;
        return deleted.startTime < clip.startTime ? sum + clipDuration(deleted) : sum;
      }, 0);
      return shift > 0 ? { ...clip, startTime: Math.max(0, clip.startTime - shift) } : clip;
    });

    deletedClips.forEach((clip) => revokeObjectUrlIfNeeded(clip.url));
    commitEditorTimeline(nextTimeline);
    setSelectedClipIds([]);
    setSelectedClipId(null);
    setEditorActiveClipIndex(0);
    setEditorPlayhead(0);
  };

  // Right-click on empty lane space (BottomTimeline's TrackRow reports the
  // lane + timeline-time under the cursor) - only opens the "Close Gap" menu
  // if that time actually falls inside a real gap between two clips (or
  // between 0 and the first clip) on that lane, matching CapCut's
  // right-click-a-gap affordance rather than a general clip context menu.
  const handleGapContextMenu = (e, type, laneIndex, time) => {
    const laneClips = editorTimeline
      .filter((clip) => laneTypeForClip(clip) === type && (clip.trackIndex || 0) === laneIndex)
      .sort((a, b) => a.startTime - b.startTime);

    let prevEnd = 0;
    let nextClip = null;
    for (const clip of laneClips) {
      if (clip.startTime > time) { nextClip = clip; break; }
      prevEnd = Math.max(prevEnd, clip.startTime + clipDuration(clip));
    }
    if (!nextClip || time < prevEnd) return;
    const gapSize = nextClip.startTime - prevEnd;
    if (gapSize <= 0.01) return;

    setGapMenu({ x: e.clientX, y: e.clientY, type, laneIndex, gapStart: prevEnd, gapSize });
  };

  const handleCloseGap = () => {
    if (!gapMenu) return;
    const { type, laneIndex, gapStart, gapSize } = gapMenu;
    commitEditorTimeline((prev) => prev.map((clip) => {
      const clipType = laneTypeForClip(clip);
      const clipLane = clip.trackIndex || 0;
      if (clipType !== type || clipLane !== laneIndex || clip.startTime < gapStart) return clip;
      return { ...clip, startTime: Math.max(0, clip.startTime - gapSize) };
    }));
    setGapMenu(null);
  };

  useEffect(() => {
    if (!gapMenu) return undefined;
    const dismiss = () => setGapMenu(null);
    // Delayed one tick so the contextmenu event that opened this menu
    // doesn't also immediately close it via the same click's mouseup.
    const id = setTimeout(() => {
      window.addEventListener('click', dismiss);
      window.addEventListener('contextmenu', dismiss);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', dismiss);
      window.removeEventListener('contextmenu', dismiss);
    };
  }, [gapMenu]);

  const handleTrimStart = (e, clipId, side) => {
    e.preventDefault();
    e.stopPropagation();
    const clip = editorTimeline.find((c) => c.id === clipId);
    if (!clip) return;
    setTrimState({
      active: true,
      clipId,
      side,
      startX: e.clientX,
      originalStart: clip.trimmedStart,
      originalEnd: clip.trimmedEnd,
      originalStartTime: clip.startTime,
      // Holding Alt while grabbing a trim handle ripples the trim: every
      // downstream (right-handle) or upstream (left-handle) same-lane clip
      // shifts by the same delta, preserving adjacency instead of opening/
      // closing a gap - captured once at gesture start, same convention
      // handleClipDragEnd already uses for insert-mode's Alt override.
      rippleMode: e.altKey,
      laneType: laneTypeForClip(clip),
      laneIndex: clip.trackIndex || 0,
    });
    setSelectedClipId(clipId);
  };

  const handleTrimEnd = (e, clipId, side) => {
    e.preventDefault();
    e.stopPropagation();
    const clip = editorTimeline.find((c) => c.id === clipId);
    if (!clip) return;
    setTrimState({
      active: true,
      clipId,
      side,
      startX: e.clientX,
      originalStart: clip.trimmedStart,
      originalEnd: clip.trimmedEnd,
      originalStartTime: clip.startTime,
      rippleMode: e.altKey,
      laneType: laneTypeForClip(clip),
      laneIndex: clip.trackIndex || 0,
    });
    setSelectedClipId(clipId);
  };

  // A grouped clip (see handleGroupSelected) selects every sibling sharing
  // its groupId, not just itself - so a plain click + drag on any one member
  // moves the whole group together, without dragging needing its own
  // group-awareness beyond "drag whatever's in selectedClipIds" (which it
  // already does).
  const selectWithGroup = (clipId) => {
    const clip = editorTimeline.find((c) => c.id === clipId);
    if (clip?.groupId) {
      setSelectedClipIds(editorTimeline.filter((c) => c.groupId === clip.groupId).map((c) => c.id));
      return;
    }
    setSelectedClipIds([clipId]);
  };

  const handleClipSelect = (clipId, event) => {
    setSelectedClipId(clipId);
    const index = editorTimeline.findIndex((c) => c.id === clipId);
    if (index >= 0) {
      setEditorActiveClipIndex(index);
    }

    if (!event) {
      selectWithGroup(clipId);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectedClipIds((prev) => {
        if (prev.includes(clipId)) {
          return prev.filter((id) => id !== clipId);
        }
        return [...prev, clipId];
      });
      return;
    }

    if (event.shiftKey && selectedClipIds.length > 0) {
      const lastSelectedId = selectedClipIds[selectedClipIds.length - 1];
      const lastIndex = editorTimeline.findIndex((c) => c.id === lastSelectedId);
      const start = Math.min(lastIndex, index);
      const end = Math.max(lastIndex, index);
      const range = editorTimeline.slice(start, end + 1).map((c) => c.id);
      setSelectedClipIds(range);
      return;
    }

    selectWithGroup(clipId);
  };

  const handleClipDragStart = (e, clipId) => {
    e.preventDefault();
    setSelectedClipId(clipId);
    // mousedown fires before the click handler that would normally expand a
    // grouped clip's selection to its siblings (see selectWithGroup), so a
    // fresh drag on a not-yet-selected group member needs that same
    // expansion done here too, or only the one clip under the cursor would
    // move.
    const clip = editorTimeline.find((c) => c.id === clipId);
    const baseIds = selectedClipIds.includes(clipId) ? [...selectedClipIds] : [clipId];
    const targetIds = clip?.groupId
      ? [...new Set([...baseIds, ...editorTimeline.filter((c) => c.groupId === clip.groupId).map((c) => c.id)])]
      : baseIds;
    setSelectedClipIds(targetIds);
    // Snapshot each dragged clip's own starting position/lane - deltas are
    // applied against these originals at drag-end, not accumulated
    // incrementally, so a long drag doesn't drift from rounding.
    const originals = new Map(
      editorTimeline
        .filter((clip) => targetIds.includes(clip.id))
        // `type` here is the clip's LANE group (images and adjustment
        // layers both ride the video lanes), which is what every
        // same-lane comparison below actually means.
        .map((clip) => [clip.id, { startTime: clip.startTime, trackIndex: clip.trackIndex || 0, type: laneTypeForClip(clip) }]),
    );
    setDragState({
      active: true,
      clipId,
      startX: e.clientX,
      startY: e.clientY,
      selectedIds: targetIds,
      originals,
    });
  };

  // Snap targets are every OTHER clip's absolute start/end (across every
  // lane - dragging near any clip's edge, not just ones on the same lane,
  // is still a useful alignment point) plus the playhead and every marker.
  const getSnapPoints = (excludeClipId) => {
    if (!snapEnabled) return [];
    const points = [];
    editorTimeline.forEach((clip) => {
      if (clip.id !== excludeClipId) {
        points.push(clip.startTime, clip.startTime + clipDuration(clip));
      }
    });
    points.push(editorPlayhead);
    markers.forEach((marker) => points.push(marker.time));
    return points;
  };

  const snapTime = (time, excludeClipId) => {
    const snapPoints = getSnapPoints(excludeClipId);
    const threshold = 0.2;
    let closest = time;
    let minDistance = threshold;
    snapPoints.forEach((point) => {
      const distance = Math.abs(time - point);
      if (distance < minDistance) {
        minDistance = distance;
        closest = point;
      }
    });
    return closest;
  };

  // Reads position straight off the mouseup event rather than tracking a
  // live currentX/Y in dragState - there's no mid-drag visual feedback to
  // drive (the dragged clip only moves on drop), so updating state on every
  // mousemove would just force a full re-render per pixel for no payoff.
  const handleClipDragEnd = (e) => {
    if (!dragState.active) return;
    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;
    const zoom = timelineZoom / 100;
    const deltaTime = deltaX / (PX_PER_SECOND * zoom);
    const originals = dragState.originals || new Map();
    // Insert mode (persistent toolbar toggle OR holding Alt for just this
    // drop) makes a drop push same-lane clips forward to make room, CapCut's
    // "insert" drop behavior, instead of the default free/overwrite
    // placement where clips can end up overlapping.
    const useInsertMode = insertMode || e.altKey;

    commitEditorTimeline((prev) => {
      const moves = new Map();
      prev.forEach((clip) => {
        const original = originals.get(clip.id);
        if (!original) return;
        const newStartTime = Math.max(0, original.startTime + deltaTime);
        const snappedStart = snapTime(newStartTime, clip.id);
        // original.type is already the lane group (see the originals
        // snapshot above), which is exactly how trackMeta is keyed.
        const metaType = original.type;
        // A type's lanes expand/collapse as one group (expandedTracks is
        // per-type, not per-lane), so this single row height is valid for
        // every lane of that type - no need to walk individual row offsets.
        const rowHeight = laneHeight(expandedTracks?.[metaType]);
        const laneDelta = Math.round(deltaY / rowHeight);
        const laneCount = trackMeta[metaType]?.length || 1;
        let newTrackIndex = Math.max(0, Math.min(original.trackIndex + laneDelta, laneCount - 1));
        // Reject a drop onto a locked destination lane - keep the clip on
        // its original lane (only startTime still moves) rather than
        // bypassing the same lock rule already enforced at drag-start for
        // the source lane.
        if (trackMeta[metaType]?.[newTrackIndex]?.locked) {
          newTrackIndex = original.trackIndex;
        }
        moves.set(clip.id, { startTime: snappedStart, trackIndex: newTrackIndex, type: original.type, duration: clipDuration(clip) });
      });

      let next = prev.map((clip) => {
        const move = moves.get(clip.id);
        return move ? { ...clip, startTime: move.startTime, trackIndex: move.trackIndex } : clip;
      });

      if (useInsertMode) {
        // Push every non-dragged clip on the SAME landing lane that starts
        // at/after the dropped clip forward by that dropped clip's
        // duration, opening up room instead of letting them overlap.
        moves.forEach((move) => {
          next = next.map((clip) => (
            !moves.has(clip.id) && laneTypeForClip(clip) === move.type && (clip.trackIndex || 0) === move.trackIndex && clip.startTime >= move.startTime
              ? { ...clip, startTime: clip.startTime + move.duration }
              : clip
          ));
        });
      }

      return next;
    });
    setDragState({ active: false, clipId: null, startX: 0, startY: 0, selectedIds: [], originals: null });
  };

  const handleTrimDragMove = (e) => {
    if (!trimState.active) return;
    const deltaX = e.clientX - trimState.startX;
    const zoom = timelineZoom / 100;
    const deltaTime = deltaX / (PX_PER_SECOND * zoom);
    const isSameLane = (clip) => laneTypeForClip(clip) === trimState.laneType && (clip.trackIndex || 0) === trimState.laneIndex;

    setEditorTimeline((prev) => {
      const trimmedClip = prev.find((clip) => clip.id === trimState.clipId);
      if (!trimmedClip) return prev;

      if (trimState.side === 'left') {
        // Dragging the left handle changes which part of the source plays
        // (trimmedStart) *and* moves startTime by the same amount, so the
        // clip's absolute end time stays put - only its start and duration
        // change, standard trim-left behavior.
        const newStart = Math.max(0, Math.min(trimState.originalStart + deltaTime, trimmedClip.trimmedEnd - 0.5));
        const clampedDelta = newStart - trimState.originalStart;
        const newStartTime = Math.max(0, trimState.originalStartTime + clampedDelta);
        const snappedStartTime = snapTime(newStartTime, trimmedClip.id);
        const appliedDelta = snappedStartTime - trimState.originalStartTime;
        return prev.map((clip) => {
          if (clip.id === trimState.clipId) {
            return { ...clip, trimmedStart: trimState.originalStart + appliedDelta, startTime: snappedStartTime };
          }
          // Ripple mode: shift every OTHER same-lane clip that started at or
          // before this clip's original start by the same delta, so the gap
          // between them and the trimmed clip's new start stays constant
          // instead of opening/closing.
          if (trimState.rippleMode && isSameLane(clip) && clip.startTime <= trimState.originalStartTime + 0.001) {
            return { ...clip, startTime: Math.max(0, clip.startTime + appliedDelta) };
          }
          return clip;
        });
      }

      // Right handle only changes trimmedEnd (duration) - startTime (the
      // left edge) stays fixed. Snap against the clip's absolute end time,
      // then convert back to a trimmedEnd delta.
      const newEnd = Math.min(trimmedClip.duration || effectiveTimelineDuration, Math.max(trimState.originalEnd + deltaTime, trimmedClip.trimmedStart + 0.5));
      const absoluteEnd = trimmedClip.startTime + (newEnd - trimmedClip.trimmedStart);
      const snappedAbsoluteEnd = snapTime(absoluteEnd, trimmedClip.id);
      const snappedEnd = newEnd + (snappedAbsoluteEnd - absoluteEnd);
      const originalAbsoluteEnd = trimState.originalStartTime + (trimState.originalEnd - trimState.originalStart);
      const rippleDelta = snappedAbsoluteEnd - originalAbsoluteEnd;
      return prev.map((clip) => {
        if (clip.id === trimState.clipId) {
          return { ...clip, trimmedEnd: snappedEnd };
        }
        // Ripple mode: shift every downstream same-lane clip (started at or
        // after this clip's original end) by the same delta the trim
        // introduced, so gaps/adjacency after it are preserved.
        if (trimState.rippleMode && isSameLane(clip) && clip.startTime >= originalAbsoluteEnd - 0.001) {
          return { ...clip, startTime: Math.max(0, clip.startTime + rippleDelta) };
        }
        return clip;
      });
    });
  };

  const handleTrimDragEnd = () => {
    // handleTrimDragMove mutates the timeline directly on every mousemove
    // tick (for live visual feedback) without pushing history each time -
    // push a single history snapshot here, once, at gesture end.
    if (trimState.active) {
      pushEditorHistory(editorTimelineRef.current);
    }
    setTrimState({ active: false, clipId: null, side: null, startX: 0, originalStart: 0, originalEnd: 0 });
  };

  const handlePlayheadDragStart = (e) => {
    e.preventDefault();
    setPlayheadDrag(true);
  };

  const handlePlayheadDragMove = (e) => {
    if (!playheadDrag) return;
    const trackSurface = document.querySelector('.timeline-track-surface');
    if (!trackSurface) return;
    const rect = trackSurface.getBoundingClientRect();
    // Absolute pixel positioning (M7) means the surface can be wider than
    // its visible/scrolled viewport, so time is derived from actual
    // pixels-per-second + scroll offset rather than a percentage of the
    // visible rect's width.
    const pxPerSecond = PX_PER_SECOND * (timelineZoom / 100);
    const newTime = Math.max(0, (e.clientX - rect.left + trackSurface.scrollLeft) / pxPerSecond);
    handleEditorSeek(newTime);
  };

  const handlePlayheadDragEnd = () => {
    setPlayheadDrag(false);
  };

  const handleTrackExpand = (trackType) => {
    setExpandedTracks((prev) => ({ ...prev, [trackType]: !prev[trackType] }));
  };

  const handleSnapToggle = () => {
    setSnapEnabled((prev) => !prev);
  };

  const handleAutoFollowToggle = () => {
    setAutoFollowPlayhead((prev) => !prev);
  };

  const handleAddTextClip = () => {
    // Appended after whatever's already on the text track's lane 0, not at
    // the global playhead - can be freely dragged elsewhere afterward.
    const laneZeroEnd = editorTextClips
      .filter((clip) => (clip.trackIndex || 0) === 0)
      .reduce((max, clip) => Math.max(max, clip.startTime + clipDuration(clip)), 0);
    const clip = createTextClip({ trackIndex: 0, startTime: laneZeroEnd, duration: 3 });
    commitEditorTimeline((prev) => [...prev, clip]);
    setSelectedClipId(clip.id);
    setSelectedClipIds([clip.id]);
  };

  // Adjustment layers (M13) always land on a brand-new video lane above
  // everything else - never lane 0, which stays the pure "base program"
  // (see editorLaneZeroVideoClips) - so a fresh layer never accidentally
  // shadows itself or ends up below the content it's meant to affect.
  const handleAddAdjustmentLayer = () => {
    const topLaneIndex = trackMeta.video.length;
    setTrackMeta((prev) => ({ ...prev, video: [...prev.video, { locked: false, hidden: false, name: null }] }));
    const clip = createAdjustmentClip({ trackIndex: topLaneIndex, startTime: editorPlayhead, duration: 3 });
    commitEditorTimeline((prev) => [...prev, clip]);
    setSelectedClipId(clip.id);
    setSelectedClipIds([clip.id]);
  };

  // Timeline markers (M13) - named points on the global timeline, not tied
  // to any clip, so they live in their own persisted array rather than the
  // clip timeline (and aren't part of undo/redo history, same as trackMeta).
  const handleAddMarker = () => {
    const marker = { id: `marker-${Date.now()}`, time: editorPlayhead, label: null };
    setMarkers((prev) => [...prev, marker].sort((a, b) => a.time - b.time));
  };

  const handleRemoveMarker = (id) => {
    setMarkers((prev) => prev.filter((marker) => marker.id !== id));
  };

  const handleRenameMarker = (id, label) => {
    setMarkers((prev) => prev.map((marker) => (marker.id === id ? { ...marker, label: label.trim() || null } : marker)));
  };

  const handleJumpToMarker = (time) => {
    handleEditorSeek(time);
  };

  const handleAddAudioClick = () => {
    audioFileInputRef.current?.click();
  };

  // Standalone clips (music/voiceover) added via the audio track's own
  // "+ Add audio" button - same addAudioFileToTimeline helper the main
  // Import button now also routes audio files through.
  const handleAudioUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    addAudioFileToTimeline(file);
    if (audioFileInputRef.current) audioFileInputRef.current.value = '';
  };

  const handleUndo = () => {
    undo?.();
  };

  const handleRedo = () => {
    redo?.();
  };

  const handleDuplicateSelected = () => {
    if (!selectedClipIds.length || !editorTimeline.length) return;
    // Ids are generated once, up front, and reused for both the timeline
    // splice and the post-duplicate selection - previously these were two
    // separately-generated id sets that never matched, so duplicates were
    // spliced in correctly but never ended up selected.
    const additions = [];
    selectedClipIds.forEach((id, idx) => {
      const original = editorTimeline.find((c) => c.id === id);
      if (!original) return;
      // Placed right after the original on the same lane - trimmedStart/
      // trimmedEnd (the source range) are unchanged, only startTime moves.
      additions.push({
        ...original,
        id: `${Date.now()}-${idx}-${Math.random().toString(16).slice(2, 8)}`,
        startTime: original.startTime + clipDuration(original),
      });
    });
    if (!additions.length) return;
    commitEditorTimeline((prev) => {
      const newTimeline = [...prev];
      const insertAt = Math.max(0, newTimeline.length - 1);
      newTimeline.splice(insertAt + 1, 0, ...additions);
      return newTimeline;
    });
    setSelectedClipIds(additions.map((clip) => clip.id));
    setSelectedClipId(additions[0].id);
  };

  const handleCopySelected = () => {
    if (!selectedClipIds.length) return;
    editorClipboardRef.current = editorTimeline
      .filter((clip) => selectedClipIds.includes(clip.id))
      .map((clip) => ({ ...clip }));
  };

  // Pastes the clipboard's clips at the playhead, preserving their relative
  // offsets and lanes (paste the earliest-starting clip AT the playhead,
  // every other clip keeps the same gap from it it had when copied) -
  // pasting a multi-clip selection keeps its internal shape rather than
  // stacking everything at one instant. Clips landing on a locked lane are
  // dropped from the paste, same rule every other edit respects.
  const handlePasteAtPlayhead = () => {
    const clips = editorClipboardRef.current;
    if (!clips.length) return;
    const earliestStart = Math.min(...clips.map((c) => c.startTime));
    const offset = editorPlayhead - earliestStart;

    const additions = [];
    clips.forEach((clip, idx) => {
      if (isClipLocked(clip)) return;
      additions.push({
        ...clip,
        id: `${Date.now()}-paste-${idx}`,
        startTime: Math.max(0, clip.startTime + offset),
      });
    });
    if (!additions.length) return;

    commitEditorTimeline((prev) => [...prev, ...additions]);
    setSelectedClipIds(additions.map((c) => c.id));
    setSelectedClipId(additions[0].id);
  };
 
  const handleGroupSelected = () => {
    if (selectedClipIds.length < 2) return;
    const groupId = `group-${Date.now()}`;
    commitEditorTimeline((prev) => prev.map((clip) => (
      selectedClipIds.includes(clip.id) ? { ...clip, groupId } : clip
    )));
  };

  const handleUngroupSelected = () => {
    if (!selectedClipIds.length) return;
    commitEditorTimeline((prev) => prev.map((clip) => (
      selectedClipIds.includes(clip.id) ? { ...clip, groupId: null } : clip
    )));
  };

  useEffect(() => {
    if (activeTab !== 'editor') return;
    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;
      const alt = event.altKey;
      const activeTag = document.activeElement?.tagName;
      const typing = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable;

      if (ctrl && key === 'z' && !shift) {
        event.preventDefault();
        handleUndo();
        return;
      }

      if (ctrl && key === 'z' && shift) {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (ctrl && key === 'y') {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (key === 'delete' || key === 'backspace') {
        if (typing) return;
        event.preventDefault();
        if (shift) {
          handleEditorRippleDelete();
        } else {
          handleEditorDelete();
        }
        return;
      }

      if (ctrl && key === 'd') {
        event.preventDefault();
        handleDuplicateSelected();
        return;
      }

      if (ctrl && key === 'c') {
        if (typing) return;
        event.preventDefault();
        handleCopySelected();
        return;
      }

      if (ctrl && key === 'v') {
        if (typing) return;
        event.preventDefault();
        handlePasteAtPlayhead();
        return;
      }

      if (alt && key === 'g') {
        event.preventDefault();
        if (shift) {
          handleUngroupSelected();
        } else {
          handleGroupSelected();
        }
        return;
      }

      if (key === ' ' || key === 'spacebar') {
        if (typing) return;
        event.preventDefault();
        handleEditorTogglePlayback();
        return;
      }

      if (key === 'k' && !ctrl && !alt) {
        if (typing) return;
        event.preventDefault();
        handleEditorSplit();
        return;
      }

      if (key === 'escape') {
        setSelectedClipId(null);
        setSelectedClipIds([]);
        return;
      }

      if (key === 'arrowleft' || key === 'arrowright') {
        if (typing) return;
        event.preventDefault();
        const step = shift ? 1 : 1 / 30;
        const delta = key === 'arrowleft' ? -step : step;
        // Functional update, not handleEditorSeek(editorPlayhead + delta):
        // rapid/held keypresses can fire multiple keydowns before React
        // re-renders and refreshes this closure's editorPlayhead, so reading
        // it directly would make every event compute the same "old + one
        // step" result and collapse into a single net nudge instead of
        // accumulating.
        setEditorPlayhead((prev) => Math.max(0, Math.min(prev + delta, editorTotalDuration || 0)));
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // undo/redo must be explicit deps, not just editorTimeline: a trim or
    // overlay-move gesture pushes its history entry in a separate update
    // AFTER the drag's last setEditorTimeline call (see handleTrimDragEnd),
    // so editorTimeline alone doesn't change when that history push
    // happens - without undo/redo listed here, this closure would keep
    // calling a stale undo/redo bound to the history state from before that
    // gesture, silently no-op-ing Ctrl+Z right after a trim.
  }, [activeTab, editorTimeline, selectedClipIds, selectedClipId, editorActiveClipIndex, editorPlayhead, trackMeta, undo, redo]);

  // Playback itself (advancing the playhead frame-by-frame, deciding which
  // clip is active, drawing to the canvas) is owned by useTimelinePlayer
  // below - this just flips the controlled isPlaying flag it reacts to.
  const handleEditorTogglePlayback = () => {
    if (!editorVideoClips.length) {
      return;
    }
    if (!editorIsPlaying && editorPlayhead >= editorTotalDuration) {
      setEditorPlayhead(0);
    }
    setEditorIsPlaying((prev) => !prev);
  };

  const handleEditorSeek = (nextTime) => {
    setEditorPlayhead(Math.max(0, Math.min(nextTime, editorTotalDuration || 0)));
  };

  const handleEditorPlaybackEnded = useCallback(() => {
    setEditorIsPlaying(false);
  }, [setEditorIsPlaying]);

  const handleEditorClipDurationUpdate = useCallback((clipId, actualDuration) => {
    setEditorTimeline((prev) => prev.map((clip) => (
      clip.id === clipId ? { ...clip, duration: actualDuration, trimmedEnd: Math.min(clip.trimmedEnd, actualDuration) } : clip
    )));
  }, [setEditorTimeline]);

  const { videoDuration: editorVideoDuration } = useTimelinePlayer({
    timeline: editorTimeline,
    currentTime: editorPlayhead,
    isPlaying: editorIsPlaying,
    onTimeUpdate: setEditorPlayhead,
    onEnded: handleEditorPlaybackEnded,
    onClipDurationUpdate: handleEditorClipDurationUpdate,
    canvasRef: editorCanvasRef,
    trackMeta,
    canvasSize: editorCanvasSize,
  });

  const handlePreviewPlayPause = () => {
    if (activeTab === 'editor') {
      handleEditorTogglePlayback();
      return;
    }

    if (!previewVideoRef.current || !currentPreviewSource) {
      return;
    }

    if (previewVideoRef.current.paused) {
      previewVideoRef.current.play();
      setPreviewIsPlaying(true);
    } else {
      previewVideoRef.current.pause();
      setPreviewIsPlaying(false);
    }
  };

  const handlePreviewSeek = (nextTime) => {
    if (activeTab === 'editor') {
      handleEditorSeek(nextTime);
      return;
    }

    if (!previewVideoRef.current) {
      return;
    }

    previewVideoRef.current.currentTime = nextTime;
    setPreviewCurrentTime(nextTime);
  };

  const handlePreviewStep = (delta) => {
    if (activeTab === 'editor') {
      handleEditorSeek(editorPlayhead + delta);
      return;
    }

    if (!previewVideoRef.current) {
      return;
    }

    const nextTime = Math.max(0, Math.min(previewVideoRef.current.currentTime + delta, previewDuration || 0));
    previewVideoRef.current.currentTime = nextTime;
    setPreviewCurrentTime(nextTime);
  };

  const handlePreviewMetadata = (event) => {
    setPreviewDuration(event.currentTarget.duration || 0);
  };

  const handlePreviewTimeUpdate = (event) => {
    setPreviewCurrentTime(event.currentTarget.currentTime || 0);
  };

  const handlePreviewPlay = () => {
    setPreviewIsPlaying(true);
  };

  const handlePreviewPause = () => {
    setPreviewIsPlaying(false);
  };

  const handlePreviewFullscreen = () => {
    if (activeTab === 'editor') {
      editorCanvasRef.current?.requestFullscreen?.();
      return;
    }

    previewVideoRef.current?.requestFullscreen?.();
  };

  const handleEditorExport = async () => {
    if (!editorLaneZeroVideoClips.length) {
      setErrorText('Add at least one clip to the base video track before exporting.');
      return;
    }
    // The export payload below already drops hidden lanes' clips entirely
    // (see exportableTimeline) - checking this up front means a hidden base
    // track fails with a clear message here instead of silently exporting
    // an empty/black video and only surfacing a confusing backend error.
    if (trackMeta?.video?.[0]?.hidden) {
      setErrorText('Unhide the base video track before exporting.');
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setProgress({ percent: 0, currentTime: 'Preparing export...' });

    // Hidden (video/text) or muted (audio) lanes are skipped entirely so the
    // export matches what the preview actually shows/plays - no backend
    // changes needed, the filter graph never sees clips on those lanes.
    // A disabled clip (M11) is dropped from the payload the same way a
    // hidden/muted lane's clips are - the backend's gap-filling logic (see
    // transition.js's chainVideoClips) already turns the resulting hole in
    // a lane's clip sequence into black/silent filler at that clip's exact
    // [startTime, endTime), so the disabled span still "takes up time" in
    // the export without the backend needing to know about `enabled` at all.
    const exportableTimeline = editorTimeline.filter((clip) => {
      const type = laneTypeForClip(clip);
      const laneIndex = clip.trackIndex || 0;
      return !trackMeta?.[type]?.[laneIndex]?.hidden && clip.enabled !== false;
    });

    const { formData, missingSourceClipId } = buildExportFormData(exportableTimeline, editorCanvasSize, 'nexeditor-export');
    if (missingSourceClipId) {
      setErrorText('One of your clips is missing its video file - try re-importing it.');
      setProcessing(false);
      setProgress({ percent: 0, currentTime: '' });
      return;
    }

    try {
      const { promise } = postExportRequest({
        formData,
        socketId,
        onProgress: setProgress,
        isStillCurrent: () => activeTabRef.current === 'editor',
      });
      const data = await promise;
      setProgress({ percent: 100, currentTime: 'Export complete' });
      await downloadExportResult(data);
    } catch (error) {
      console.error('Editor export failed:', error);
      setErrorText(error.message || 'Failed to export the timeline.');
      setProgress({ percent: 0, currentTime: '' });
    } finally {
      setProcessing(false);
    }
  };

  // LongMix Studio renders on the server and hands back a finished video,
  // the same shape as Shorts or Captions - the editor is somewhere the user
  // can go afterwards, not somewhere they have to go first. The assembled
  // clips are kept in state so "Open in editor" can hand the exact same
  // timeline over for hand-editing, and so the chapter list describes the
  // very clips that were rendered.
  const handleLongMixCreate = async () => {
    if (!longMixSongs.length || !longMixScenes.length || longMixBuilding) return;

    let assembled;
    try {
      assembled = buildLongMixTimeline(longMixSongs, longMixScenes, longMixSettings);
    } catch (error) {
      console.error('LongMix assembly failed:', error);
      setErrorText(error.message || 'Could not build the mix from those files.');
      return;
    }

    const canvasSize = buildCanvasSize({
      aspectRatioId: longMixSettings.aspectRatioId,
      resolutionId: longMixSettings.resolutionId,
      fps: LONGMIX_FPS,
    });
    const { formData, missingSourceClipId } = buildExportFormData(assembled.clips, canvasSize, 'longmix');
    if (missingSourceClipId) {
      setErrorText('One of the songs or scenes is missing its file - re-add it and try again.');
      return;
    }
    // The server renders a long mix from this compact description (songs in
    // the order they're listed, real durations measured there) with its own
    // fast pipeline - the clips above only carry the files and back the
    // "Open in editor" hand-off.
    formData.append('longMix', JSON.stringify({
      songs: longMixSongs.map((song) => ({ sourceId: song.sourceId, title: song.title, duration: song.duration })),
      scenes: longMixScenes.map((scene) => ({ sourceId: scene.sourceId, kind: scene.kind, duration: scene.duration })),
      settings: {
        crossfade: longMixSettings.crossfade,
        sceneMode: longMixSettings.sceneMode,
        sceneIntervalMinutes: longMixSettings.sceneIntervalMinutes,
        motionPresetId: longMixSettings.motionPresetId,
        targetMinutes: longMixSettings.targetMinutes,
        fps: longMixSettings.fps,
      },
    }));

    setLongMixBuilding(true);
    setLongMixResult(null);
    setErrorText(null);
    setProgress({ percent: 0, currentTime: 'Preparing your mix...' });

    const { jobId, promise } = postExportRequest({
      formData,
      socketId,
      onProgress: setProgress,
      isStillCurrent: () => activeTabRef.current === 'longmix',
    });
    // Persisted right away, not just once it resolves - the render is
    // already running server-side by this point (see exportTimeline.js's
    // early 202), so this is what a reload mid-render resumes from (see the
    // resume effect below).
    setLongMixJobId(jobId);

    try {
      const data = await promise;
      setProgress({ percent: 100, currentTime: 'Your mix is ready' });
      setLongMixResult(data);
    } catch (error) {
      console.error('LongMix render failed:', error);
      setErrorText(error.message || 'Failed to render the mix.');
      setProgress({ percent: 0, currentTime: '' });
    } finally {
      setLongMixBuilding(false);
    }
  };

  // A jobId still marked `building` after restore means a render was
  // actually still running (or had already finished) on the server when
  // this reloaded - the connection dying doesn't kill it (see
  // exportTimeline.js's early 202). Reattach to it instead of leaving the
  // wizard stuck on a spinner nothing is ever going to resolve.
  useEffect(() => {
    if (!longMixRestored || !longMixBuilding || !longMixJobId) return;
    let cancelled = false;
    setProgress({ percent: 0, currentTime: 'Reconnecting to your mix...' });
    pollExportProgress({
      jobId: longMixJobId,
      onProgress: setProgress,
      isStillCurrent: () => !cancelled && activeTabRef.current === 'longmix',
    }).then((data) => {
      if (cancelled) return;
      setProgress({ percent: 100, currentTime: 'Your mix is ready' });
      setLongMixResult(data);
      setLongMixBuilding(false);
    }).catch((error) => {
      if (cancelled) return;
      console.error('LongMix render failed:', error);
      setErrorText(error.message || 'Failed to render the mix.');
      setProgress({ percent: 0, currentTime: '' });
      setLongMixBuilding(false);
    });
    return () => {
      cancelled = true;
    };
    // Only ever fires off the restore itself, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [longMixRestored]);

  // A finished mix restored from a previous session may have aged out of the
  // server's retention window - drop it up front rather than showing a player
  // and a Download button that lead nowhere.
  useEffect(() => {
    if (!longMixRestored || !longMixResult) return;
    let cancelled = false;
    exportResultStatus(longMixResult).then((status) => {
      if (!cancelled && status === 'expired') setLongMixResult(null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [longMixRestored]);

  // Hands the mix to the editor for hand-editing. The clips are rebuilt here
  // from the songs/scenes/settings (a pure function of them - nothing to
  // persist), using the song lengths the server measured while rendering so
  // the editor's timeline lines up with the file that came back. Lane counts
  // are grown to fit first: songs need two audio lanes to crossfade across
  // (see longMix.js SONG_LANES) and a lane with no trackMeta entry wouldn't
  // render a row. It replaces whatever is on the timeline - a long mix
  // defines the whole project - and goes through commitEditorTimeline, so one
  // Undo puts the previous timeline back.
  const handleLongMixOpenInEditor = () => {
    if (!longMixSongs.length || !longMixScenes.length) return;
    const measured = longMixResult?.songDurations || {};
    const longMixClips = buildLongMixTimeline(
      longMixSongs.map((song) => ({ ...song, duration: measured[song.sourceId] || song.duration })),
      longMixScenes,
      longMixSettings,
    ).clips;
    const audioLanesNeeded = longMixClips.reduce((max, clip) => (clip.type === 'audio' ? Math.max(max, (clip.trackIndex || 0) + 1) : max), 1);
    setTrackMeta((prev) => {
      const grow = (lanes, needed) => (lanes.length >= needed
        ? lanes
        : [...lanes, ...Array.from({ length: needed - lanes.length }, () => ({ locked: false, hidden: false, name: null }))]);
      return { ...prev, video: grow(prev.video, 1), audio: grow(prev.audio, audioLanesNeeded) };
    });
    setEditorCanvasSize(buildCanvasSize({
      aspectRatioId: longMixSettings.aspectRatioId,
      resolutionId: longMixSettings.resolutionId,
      fps: LONGMIX_FPS,
    }));
    commitEditorTimeline(longMixClips);
    setSelectedClipId(null);
    setSelectedClipIds([]);
    setEditorPlayhead(0);
    setActiveTab('editor');
  };

  // Chapters come from the server's own layout of the finished file (they
  // travel in the render result, so they also survive a reload), which is
  // what keeps the timestamps from drifting from the video that comes back.
  const longMixChapters = useMemo(
    () => (longMixResult?.chapters || []).map((chapter, index) => ({ id: index, ...chapter })),
    [longMixResult],
  );
  const longMixRuntime = longMixResult?.duration || 0;

  const triggerExport = () => {
    if (activeTab === 'media') {
      handleMontageConvert();
    } else if (activeTab === 'captions') {
      handleCaptionConvert();
    } else if (activeTab === 'shorts') {
      handleShortsConvert();
    } else if (activeTab === 'editor') {
      handleEditorExport();
    } else if (activeTab === 'longmix') {
      handleLongMixCreate();
    }
  };

  const selectedShort = shortsResults?.find((clip) => clip.id === selectedShortId) || shortsResults?.[0] || null;
  const currentPreviewSource = activeTab === 'editor' ? editorTimeline[editorActiveClipIndex]?.url || '' : selectedShort?.url || (resultTab === activeTab ? resultUrl : '') || '';
  const currentTime = activeTab === 'editor' ? editorPlayhead : previewCurrentTime;
  const totalTime = activeTab === 'editor' ? editorTotalDuration : previewDuration;
  const isPlaying = activeTab === 'editor' ? editorIsPlaying : previewIsPlaying;

  const mediaProps = {
    video1State,
    setVideo1State,
    video2State,
    setVideo2State,
    video3State,
    setVideo3State,
    audioState,
    setAudioState,
    socketId,
    processing,
    onError: setErrorText,
    onMerge: handleMontageConvert,
    loadVideoInEditor,
    resultUrl: resultTab === 'media' ? resultUrl : null,
    outputFileName: 'montage_video.mp4',
    progress,
    onReset: handleReset,
    onAudioSelect: handleAudioSelect,
    onVideo1UrlFetch: handleVideo1UrlFetch,
    onVideo2UrlFetch: handleVideo2UrlFetch,
    onVideo3UrlFetch: handleVideo3UrlFetch,
    onAudioUrlFetch: handleAudioUrlFetch,
    onShurfer: () => setActiveTab('shorts'),
  };

  const captionsProps = {
    captionVideo: captionVideoState?.file || null,
    captionVideoRef,
    captionFile: captionFileState?.file || null,
    captionRef,
    handleCaptionSelect,
    onCaptionVideoUrlFetch: handleCaptionVideoUrlFetch,
    captionVideoMeta,
    captionFileMeta,
    onGenerate: handleCaptionConvert,
    onReset: handleReset,
    processing,
    progress: progress?.percent || 0,
    progressText: progress?.currentTime || '',
    resultUrl: resultTab === 'captions' ? resultUrl : null,
  };

  const shortsProps = {
    shortsVideo: shortsVideoState.file,
    shortsVideoRef,
    handleVideoSelect,
    setShortsVideo: setShortsVideoState,
    onShortsVideoUrlFetch: handleShortsVideoUrlFetch,
    shortsVideoMeta,
    setShortsVideoMeta,
    duration: shortsDuration,
    setDuration: setShortsDuration,
    format: shortsFormat,
    setFormat: setShortsFormat,
    onGenerate: handleShortsConvert,
    processing,
    progress: progress?.percent || 0,
    progressText: progress?.currentTime || '',
    results: shortsResults || [],
    selectedShortId,
    onSelectShort: setSelectedShortId,
    onDownload: handleShortDownload,
    onReformat: handleReformat,
  };

  const longMixProps = {
    songs: longMixSongs,
    setSongs: setLongMixSongs,
    scenes: longMixScenes,
    setScenes: setLongMixScenes,
    settings: longMixSettings,
    setSettings: setLongMixSettings,
    onCreate: handleLongMixCreate,
    building: longMixBuilding,
    progress: progress?.percent || 0,
    progressText: progress?.currentTime || '',
    result: longMixResult,
    resultUrl: exportResultUrl(longMixResult),
    onDownload: async () => {
      if (!longMixResult) return;
      try {
        await downloadExportResult(longMixResult);
      } catch (error) {
        setErrorText(error.message);
        // Only a file the server confirmed is gone is dropped (back to
        // "Create the video"); a server that just couldn't be reached keeps
        // the result so the click can be retried.
        if (error.expired) setLongMixResult(null);
      }
    },
    chapters: longMixChapters,
    runtime: longMixRuntime,
    onOpenEditor: handleLongMixOpenInEditor,
    onError: setErrorText,
  };

  const editorTimelineContextValue = useMemo(() => ({
    timeline: editorTimeline,
    selectedClipId,
    setSelectedClipId,
    selectedClipIds,
    setSelectedClipIds,
    updateClip: updateEditorClip,
    commitTimeline: commitEditorTimeline,
    undo,
    redo,
  }), [editorTimeline, selectedClipId, selectedClipIds, updateEditorClip, commitEditorTimeline, undo, redo]);

  const editorPlaybackContextValue = useMemo(() => ({
    playhead: editorPlayhead,
    isPlaying: editorIsPlaying,
    activeClipIndex: editorActiveClipIndex,
  }), [editorPlayhead, editorIsPlaying, editorActiveClipIndex]);

  return (
    <div id="app-shell">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onExport={triggerExport}
        exporting={activeTab === 'editor' && processing}
        exportProgress={progress?.percent || 0}
        projectName={projectName}
        currentProjectId={currentProjectId}
        projectSyncStatus={projectSyncStatus}
        onSaveProject={saveProjectToAccount}
        onOpenProjects={() => setProjectsModalOpen(true)}
        canvasSize={editorCanvasSize}
      />
      <EditorStateProvider timelineValue={editorTimelineContextValue} playbackValue={editorPlaybackContextValue}>
      <div id="main-area">
        <LeftSidebar activeTab={activeTab} onSelect={setActiveTab} onOpenProjects={() => setProjectsModalOpen(true)} />
        <CenterPanel
          activeTab={activeTab}
          mediaProps={mediaProps}
          captionsProps={captionsProps}
          shortsProps={shortsProps}
          longMixProps={longMixProps}
          resultUrl={resultUrl}
          shortsResults={shortsResults}
          selectedShortId={selectedShortId}
          onSelectShort={setSelectedShortId}
          processing={processing}
          progress={progress}
          handleReset={handleReset}
          handleReformat={handleReformat}
          handleShortDownload={handleShortDownload}
          previewSrc={currentPreviewSource}
          previewVideoRef={previewVideoRef}
          previewCurrentTime={currentTime}
          previewDuration={totalTime}
          previewIsPlaying={isPlaying}
          onPreviewMetadata={handlePreviewMetadata}
          onPreviewTimeUpdate={handlePreviewTimeUpdate}
          onPreviewPlay={handlePreviewPlay}
          onPreviewPause={handlePreviewPause}
          onTogglePlayback={handlePreviewPlayPause}
          onSeek={handlePreviewSeek}
          onStep={handlePreviewStep}
          onFullscreen={handlePreviewFullscreen}
          editorProps={{
            bannerVisible: editorBannerVisible,
            onDismissBanner: () => setEditorBannerVisible(false),
            timeline: editorTimeline,
            selectedClipId,
            selectedClip: editorTimeline.find((clip) => clip.id === selectedClipId) || null,
            onSelectClip: handleClipSelect,
            onImportClick: () => editorFileInputRef.current?.click(),
            onUpload: handleEditorUpload,
            fileInputRef: editorFileInputRef,
            canvasRef: editorCanvasRef,
            isPlaying: editorIsPlaying,
            currentTime: editorPlayhead,
            videoDuration: editorVideoDuration,
            onTogglePlayback: handleEditorTogglePlayback,
            onSeek: handleEditorSeek,
            // Mirrors the timeline's own trim-drag pattern: live-update via
            // the raw setter (no history spam on every mousemove tick), then
            // push a single history snapshot once at drag-end.
            onMoveOverlay: (clipId, x, y) => setEditorTimeline((prev) => prev.map((clip) => (
              clip.id === clipId ? { ...clip, transform: { ...clip.transform, x, y } } : clip
            ))),
            onMoveOverlayEnd: () => pushEditorHistory(editorTimelineRef.current),
            canvasSize: editorCanvasSize,
            onCanvasSizeChange: setEditorCanvasSize,
          }}
      />
        {activeTab === 'editor' && <RightPanel />}
      </div>
      {activeTab === 'editor' && <BottomTimeline
        activeTab={activeTab}
        style={{ display: activeTab === 'editor' ? 'flex' : 'none' }}
        tracks={timelineTracks}
        currentTime={currentTime}
        totalDuration={effectiveTimelineDuration}
        zoom={timelineZoom}
        onZoomChange={setTimelineZoom}
        onSeek={handlePreviewSeek}
        onSplit={activeTab === 'editor' ? handleEditorSplit : undefined}
        onDelete={activeTab === 'editor' ? handleEditorDelete : undefined}
        onTrimStart={activeTab === 'editor' ? handleTrimStart : undefined}
        onTrimEnd={activeTab === 'editor' ? handleTrimEnd : undefined}
        timelineHeight={timelineHeight}
        onTimelineHeightChange={setTimelineHeight}
        laneLabels={laneLabels}
        selectedClipId={selectedClipId}
        selectedClipIds={selectedClipIds}
        onSelectClip={handleClipSelect}
        onClipDragStart={handleClipDragStart}
        snapEnabled={snapEnabled}
        onSnapToggle={handleSnapToggle}
        expandedTracks={expandedTracks}
        onTrackExpand={handleTrackExpand}
        autoFollowPlayhead={autoFollowPlayhead}
        onAutoFollowToggle={handleAutoFollowToggle}
        onPlayheadDragStart={handlePlayheadDragStart}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onAddTextClip={handleAddTextClip}
        onAddAudioClip={handleAddAudioClick}
        onAddTrack={handleAddTrack}
        onRemoveTrack={handleRemoveTrack}
        onRenameTrack={handleRenameTrack}
        onReorderTrack={handleReorderTrack}
        trackState={trackMeta}
        onToggleLock={handleToggleTrackLock}
        onToggleHidden={handleToggleTrackHidden}
        onRippleDelete={handleEditorRippleDelete}
        insertMode={insertMode}
        onInsertModeToggle={() => setInsertMode((prev) => !prev)}
        onGapContextMenu={handleGapContextMenu}
        onGroupSelected={handleGroupSelected}
        onUngroupSelected={handleUngroupSelected}
        onFreezeFrame={handleFreezeFrame}
        onAddAdjustmentLayer={handleAddAdjustmentLayer}
        markers={markers}
        onAddMarker={handleAddMarker}
        onRemoveMarker={handleRemoveMarker}
        onRenameMarker={handleRenameMarker}
        onJumpToMarker={handleJumpToMarker}
      />}
      {gapMenu && (
        <div
          className="timeline-gap-menu"
          style={{ position: 'fixed', left: gapMenu.x, top: gapMenu.y, zIndex: 1000 }}
        >
          <button type="button" onClick={handleCloseGap}>Close Gap</button>
        </div>
      )}
      <input ref={audioFileInputRef} type="file" accept="audio/*,video/*" onChange={handleAudioUpload} className="sr-only-input" style={{ display: 'none' }} />
      </EditorStateProvider>
      <ErrorPopup errorText={errorText} setErrorText={setErrorText} />
      <JobsResumeBanner />
      {projectsModalOpen && (
        <ProjectsModal
          onClose={() => setProjectsModalOpen(false)}
          onResume={async (id) => {
            await loadProjectFromAccount(id);
            setActiveTab('editor');
          }}
        />
      )}
    </div>
  );
}

export default App;

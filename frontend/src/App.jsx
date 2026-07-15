import { useEffect, useMemo, useRef, useState } from 'react';
import API_BASE_URL, { API_ENDPOINTS } from './config';
import { useSocket } from './context/SocketContext';
import { useMediaState } from './hooks/useMediaState';
import TopBar from './components/TopBar';
import LeftSidebar from './components/LeftSidebar';
import CenterPanel from './components/CenterPanel';
import RightPanel from './components/RightPanel';
import ErrorPopup from './components/ErrorPopup';
import MontageTab from './components/MontageTab';
import BottomTimeline from './components/BottomTimeline';

const VALID_TABS = ['media', 'captions', 'shorts', 'editor'];

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
    errorText,
    setErrorText,
    progress,
    setProgress,
    editorBannerVisible,
    setEditorBannerVisible,
    editorTimeline,
    setEditorTimeline,
    editorPlayhead,
    setEditorPlayhead,
    editorIsPlaying,
    setEditorIsPlaying,
    editorActiveClipIndex,
    setEditorActiveClipIndex,
    timelineZoom,
    setTimelineZoom,
    editorVideo,
    loadVideoInEditor,
    clearEditorState,
    previewCurrentTime,
    setPreviewCurrentTime,
    previewDuration,
    setPreviewDuration,
    previewIsPlaying,
    setPreviewIsPlaying,
  } = mediaState;

  const video1Ref = useRef(null);
  const video2Ref = useRef(null);
  const video3Ref = useRef(null);
  const audioRef = useRef(null);
  const captionVideoRef = useRef(null);
  const captionRef = useRef(null);
  const shortsVideoRef = useRef(null);

  const editorVideoRef = useRef(null);
  const editorFileInputRef = useRef(null);
  const editorAnimationRef = useRef(null);
  const editorTimelineRef = useRef([]);
  const previewVideoRef = useRef(null);

  const editorTotalDuration = useMemo(
    () => editorTimeline.reduce((acc, clip) => acc + (clip.trimmedEnd - clip.trimmedStart), 0),
    [editorTimeline],
  );

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

  useEffect(() => {
    if (!VALID_TABS.includes(activeTab)) {
      setActiveTab('editor');
    }
  }, [activeTab, setActiveTab]);

  // Listen for ffmpeg progress updates
  useEffect(() => {
    if (!socket) return;

    socket.on('ffmpeg-progress', (payload) => {
      setProgress({
        percent: payload?.percent || 0,
        currentTime: payload?.currentTime || '',
      });
    });

    return () => {
      socket.off('ffmpeg-progress');
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
      setEditorTimeline((previous) => {
        previous.forEach((clip) => revokeObjectUrlIfNeeded(clip.url));
        return [
          {
            id: `montage-${Date.now()}`,
            file: { name: editorVideo.fileName },
            url: remoteUrl,
            duration: tempVideo.duration,
            trimmedStart: 0,
            trimmedEnd: tempVideo.duration,
          },
        ];
      });
      setEditorPlayhead(0);
      setEditorActiveClipIndex(0);
      setEditorIsPlaying(false);
      if (editorVideoRef.current) {
        editorVideoRef.current.pause();
        editorVideoRef.current.src = remoteUrl;
        editorVideoRef.current.currentTime = 0;
      }
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

  useEffect(() => {
    if (!editorVideoRef.current || editorTimeline.length === 0 || editorIsPlaying) {
      return;
    }

    let accumulatedTime = 0;
    for (let i = 0; i < editorTimeline.length; i += 1) {
      const clipDuration = editorTimeline[i].trimmedEnd - editorTimeline[i].trimmedStart;
      if (editorPlayhead >= accumulatedTime && editorPlayhead < accumulatedTime + clipDuration) {
        if (editorActiveClipIndex !== i) {
          setEditorActiveClipIndex(i);
        }

        const localTarget = editorTimeline[i].trimmedStart + (editorPlayhead - accumulatedTime);
        if (Math.abs(editorVideoRef.current.currentTime - localTarget) > 0.2) {
          editorVideoRef.current.src = editorTimeline[i].url;
          editorVideoRef.current.currentTime = localTarget;
        }
        break;
      }
      accumulatedTime += clipDuration;
    }
  }, [editorActiveClipIndex, editorIsPlaying, editorPlayhead, editorTimeline]);

  useEffect(() => {
    if (editorPlayhead === 0 && editorVideoRef.current && editorTimeline.length > 0) {
      editorVideoRef.current.pause();
      editorVideoRef.current.currentTime = editorTimeline[0].trimmedStart;
    }
  }, [editorPlayhead, editorTimeline]);

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
    if (!captionVideoState.file || (!isAutomatic && !captionFileState.file)) {
      setErrorText(isAutomatic ? 'Please upload a video to generate captions.' : 'Please upload exactly 1 Video and 1 Subtitle file.');
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setResultUrl(null);
    setProgress({ percent: 0, currentTime: '' });

    const formData = new FormData();
    formData.append("video", captionVideoState.file);
    if (!isAutomatic) formData.append("subtitle", captionFileState.file);
    if (isAutomatic) {
      formData.append('mode', mode);
      formData.append('language', options.language || 'English (US)');
      formData.append('source', options.source || 'All audio');
      formData.append('removeFillers', String(Boolean(options.removeFillers)));
    }
    formData.append('captionPosition', options.captionPosition || 'bottom');

    try {
      const blob = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        let progressTimer;
        request.open('POST', isAutomatic ? API_ENDPOINTS.generateCaptions : API_ENDPOINTS.burnSubtitles);
        request.responseType = 'blob';
        if (socketId) request.setRequestHeader('X-Socket-Id', socketId);
        if (isAutomatic) request.setRequestHeader('X-Job-Id', jobId);
        request.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const uploadPercent = Math.max(1, Math.min(10, (event.loaded / event.total) * 10));
          setProgress({ percent: uploadPercent, currentTime: `Uploading video ${Math.round((event.loaded / event.total) * 100)}%...` });
        };
        if (isAutomatic) {
          progressTimer = setInterval(async () => {
            try {
              const response = await fetch(`${API_ENDPOINTS.generateCaptions}/progress/${jobId}`, { cache: 'no-store' });
              if (!response.ok) return;
              const status = await response.json();
              if (status.percent > 10 || status.currentTime !== 'Waiting for upload...') setProgress(status);
            } catch { /* socket progress remains available */ }
          }, 750);
        }
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
          if (!event.lengthComputable) return;
          const percent = event.loaded / event.total;
          setProgress({ percent: Math.max(1, percent * 10), currentTime: `Uploading source video ${Math.round(percent * 100)}%...` });
        };
        progressTimer = setInterval(async () => {
          try {
            const response = await fetch(`${API_ENDPOINTS.extractShorts}/progress/${jobId}`, { cache: 'no-store' });
            if (!response.ok) return;
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
    setProgress({ percent: 0, currentTime: '' });
    if (clearStorage) {
      setErrorText(null);
    }
  };

  const handleEditorUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const url = URL.createObjectURL(file);
    const tempVideo = document.createElement('video');
    tempVideo.src = url;
    tempVideo.onloadedmetadata = () => {
      setEditorTimeline((previous) => [
        ...previous,
        {
          id: `${Date.now()}-${previous.length}`,
          file,
          url,
          duration: tempVideo.duration,
          trimmedStart: 0,
          trimmedEnd: tempVideo.duration,
        },
      ]);
    };
  };

  const handleEditorSplit = () => {
    let accumulatedTime = 0;
    let targetIndex = -1;
    let localTime = 0;

    for (let i = 0; i < editorTimeline.length; i += 1) {
      const clipDuration = editorTimeline[i].trimmedEnd - editorTimeline[i].trimmedStart;
      if (editorPlayhead >= accumulatedTime && editorPlayhead < accumulatedTime + clipDuration) {
        targetIndex = i;
        localTime = editorPlayhead - accumulatedTime;
        break;
      }
      accumulatedTime += clipDuration;
    }

    if (targetIndex === -1) {
      return;
    }

    const clipToSplit = editorTimeline[targetIndex];
    const splitPoint = clipToSplit.trimmedStart + localTime;

    const leftClip = {
      ...clipToSplit,
      trimmedEnd: splitPoint,
    };

    const rightClip = {
      ...clipToSplit,
      id: `${Date.now()}-${targetIndex + 1}`,
      trimmedStart: splitPoint,
    };

    const updatedTimeline = [...editorTimeline];
    updatedTimeline.splice(targetIndex, 1, leftClip, rightClip);
    setEditorTimeline(updatedTimeline);
  };

  const handleEditorDelete = () => {
    if (!editorTimeline.length) {
      return;
    }

    const removedClip = editorTimeline[editorActiveClipIndex];
    revokeObjectUrlIfNeeded(removedClip?.url);

    const nextTimeline = editorTimeline.filter((_clip, index) => index !== editorActiveClipIndex);
    setEditorTimeline(nextTimeline);
    setEditorActiveClipIndex(0);
    setEditorPlayhead(0);
  };

  const handleTrimStart = (clipId) => {
    setEditorTimeline((prev) => prev.map((clip) => {
      if (clip.id !== clipId) return clip;
      const newStart = Math.min(clip.trimmedStart + 0.5, clip.trimmedEnd - 0.5);
      return { ...clip, trimmedStart: newStart };
    }));
  };

  const handleTrimEnd = (clipId) => {
    setEditorTimeline((prev) => prev.map((clip) => {
      if (clip.id !== clipId) return clip;
      const newEnd = Math.max(clip.trimmedEnd - 0.5, clip.trimmedStart + 0.5);
      return { ...clip, trimmedEnd: newEnd };
    }));
  };

  const handleEditorTogglePlayback = () => {
    if (!editorVideoRef.current || !editorTimeline.length) {
      return;
    }

    if (editorIsPlaying) {
      editorVideoRef.current.pause();
      cancelAnimationFrame(editorAnimationRef.current);
      setEditorIsPlaying(false);
      return;
    }

    let accumulatedTime = 0;
    let targetIndex = -1;
    let localTime = 0;

    for (let i = 0; i < editorTimeline.length; i += 1) {
      const clipDuration = editorTimeline[i].trimmedEnd - editorTimeline[i].trimmedStart;
      if (editorPlayhead >= accumulatedTime && editorPlayhead < accumulatedTime + clipDuration) {
        targetIndex = i;
        localTime = editorPlayhead - accumulatedTime;
        break;
      }
      accumulatedTime += clipDuration;
    }

    if (targetIndex === -1) {
      setEditorPlayhead(0);
      targetIndex = 0;
      localTime = 0;
    }

    if (editorActiveClipIndex !== targetIndex) {
      setEditorActiveClipIndex(targetIndex);
    }

    const targetClip = editorTimeline[targetIndex];
    editorVideoRef.current.src = targetClip.url;
    editorVideoRef.current.currentTime = targetClip.trimmedStart + localTime;

    const playPromise = editorVideoRef.current.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        setEditorIsPlaying(true);
      }).catch(() => {
        setEditorIsPlaying(false);
      });
    } else {
      setEditorIsPlaying(true);
    }

    const updatePlayhead = () => {
      if (!editorVideoRef.current) {
        return;
      }

      const video = editorVideoRef.current;
      const currentLocal = video.currentTime;

      if (video.ended || currentLocal >= editorTimeline[editorActiveClipIndex]?.trimmedEnd) {
        if (editorActiveClipIndex + 1 < editorTimeline.length) {
          const nextIndex = editorActiveClipIndex + 1;
          setEditorActiveClipIndex(nextIndex);
          video.src = editorTimeline[nextIndex].url;
          video.currentTime = editorTimeline[nextIndex].trimmedStart;
          const nextPlayPromise = video.play();
          if (nextPlayPromise !== undefined) {
            nextPlayPromise.catch(() => {
              setEditorIsPlaying(false);
            });
          }
        } else {
          video.pause();
          setEditorIsPlaying(false);
          const finalTime = editorTotalDuration || 0;
          setEditorPlayhead(finalTime);
          return;
        }
      }

      let accumulated = 0;
      for (let i = 0; i < editorActiveClipIndex; i += 1) {
        accumulated += editorTimeline[i].trimmedEnd - editorTimeline[i].trimmedStart;
      }

      const newGlobalPlayhead = accumulated + (currentLocal - (editorTimeline[editorActiveClipIndex]?.trimmedStart || 0));
      setEditorPlayhead(newGlobalPlayhead);

      editorAnimationRef.current = requestAnimationFrame(updatePlayhead);
    };

    editorAnimationRef.current = requestAnimationFrame(updatePlayhead);
  };

  const handleEditorSeek = (nextTime) => {
    setEditorPlayhead(Math.max(0, Math.min(nextTime, editorTotalDuration || 0)));
  };

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
      editorVideoRef.current?.requestFullscreen?.();
      return;
    }

    previewVideoRef.current?.requestFullscreen?.();
  };

  const triggerExport = () => {
    if (activeTab === 'media') {
      handleMontageConvert();
    } else if (activeTab === 'captions') {
      handleCaptionConvert();
    } else if (activeTab === 'shorts') {
      handleShortsConvert();
    }
  };

  const selectedShort = shortsResults?.find((clip) => clip.id === selectedShortId) || shortsResults?.[0] || null;
  const currentPreviewSource = activeTab === 'editor' ? editorTimeline[editorActiveClipIndex]?.url || '' : selectedShort?.url || resultUrl || '';
  const currentTime = activeTab === 'editor' ? editorPlayhead : previewCurrentTime;
  const totalTime = activeTab === 'editor' ? editorTotalDuration : previewDuration;
  const isPlaying = activeTab === 'editor' ? editorIsPlaying : previewIsPlaying;

  const timelineTracks = useMemo(() => {
    if (activeTab === 'editor') {
      return {
        video: editorTimeline.map((clip, index) => ({
          id: clip.id,
          label: clip.file?.name || `Clip ${index + 1}`,
          duration: clip.trimmedEnd - clip.trimmedStart,
          type: 'video',
        })),
        audio: [],
        text: [],
      };
    }

    const videoClips = [];
    const audioClips = [];
    const textClips = [];

    if (activeTab === 'media') {
      [video1Meta, video2Meta, video3Meta].filter(Boolean).forEach((clip, index) => {
        videoClips.push({
          id: `media-${index}`,
          label: clip.name,
          duration: 8,
          type: 'video',
        });
      });
      if (audioMeta) {
        audioClips.push({
          id: 'media-audio',
          label: audioMeta.name,
          duration: 16,
          type: 'audio',
        });
      }
    }

    if (activeTab === 'captions') {
      if (captionVideoMeta) {
        videoClips.push({
          id: 'caption-video',
          label: captionVideoMeta.name,
          duration: 12,
          type: 'video',
        });
      }
      if (captionFileMeta) {
        textClips.push({
          id: 'caption-text',
          label: captionFileMeta.name,
          duration: 10,
          type: 'text',
        });
      }
    }

    if (activeTab === 'shorts') {
      if (shortsVideoMeta) {
        videoClips.push({
          id: 'short-source',
          label: shortsVideoMeta.name,
          duration: 18,
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

    return {
      video: videoClips,
      audio: audioClips,
      text: textClips,
    };
  }, [activeTab, audioMeta, captionFileMeta, captionVideoMeta, editorTimeline, shortsResults, shortsVideoMeta, video1Meta, video2Meta, video3Meta]);

  const effectiveTimelineDuration = activeTab === 'editor'
    ? Math.max(editorTotalDuration, 32)
    : Math.max(
        32,
        timelineTracks.video.reduce((acc, clip) => acc + clip.duration, 0),
        timelineTracks.audio.reduce((acc, clip) => acc + clip.duration, 0),
        timelineTracks.text.reduce((acc, clip) => acc + clip.duration, 0),
      );

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
    resultUrl,
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
    captionVideo: captionVideoState.file,
    captionVideoRef,
    captionFile: captionFileState.file,
    captionRef,
    handleCaptionSelect,
    onCaptionVideoUrlFetch: handleCaptionVideoUrlFetch,
    captionVideoMeta,
    captionFileMeta,
    onGenerate: handleCaptionConvert,
    processing,
    progress: progress?.percent || 0,
    progressText: progress?.currentTime || '',
    resultUrl,
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
  };

  return (
    <div id="app-shell">
      <TopBar activeTab={activeTab} onTabChange={setActiveTab} onExport={triggerExport} />
      <div id="main-area">
        <LeftSidebar activeTab={activeTab} onSelect={setActiveTab} />
        <CenterPanel
          activeTab={activeTab}
          mediaProps={mediaProps}
          captionsProps={captionsProps}
          shortsProps={shortsProps}
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
            activeClipIndex: editorActiveClipIndex,
            onSelectClip: setEditorActiveClipIndex,
            onImportClick: () => editorFileInputRef.current?.click(),
            onUpload: handleEditorUpload,
            fileInputRef: editorFileInputRef,
            videoRef: editorVideoRef,
            currentClip: editorTimeline[editorActiveClipIndex],
            editorVideo,
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
      />}
      <ErrorPopup errorText={errorText} setErrorText={setErrorText} />
    </div>
  );
}

export default App;

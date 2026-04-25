import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_ENDPOINTS } from './config';
import { usePersistedState } from './hooks/usePersistedState';
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
} from './constants/storageKeys';
import TopBar from './components/TopBar';
import LeftSidebar from './components/LeftSidebar';
import CenterPanel from './components/CenterPanel';
import RightPanel from './components/RightPanel';
import BottomTimeline from './components/BottomTimeline';
import ErrorPopup from './components/ErrorPopup';

const VALID_TABS = ['media', 'captions', 'shorts', 'editor'];

async function readErrorMessage(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json();
    return data?.error || 'Request failed';
  }

  return response.text();
}

function App() {
  const [activeTab, setActiveTab] = usePersistedState(KEY_ACTIVE_TAB, 'editor');

  const [video1, setVideo1] = useState(null);
  const [video2, setVideo2] = useState(null);
  const [video3, setVideo3] = useState(null);
  const [audio, setAudio] = useState(null);

  const [video1Meta, setVideo1Meta] = usePersistedState(KEY_VIDEO1_META, null);
  const [video2Meta, setVideo2Meta] = usePersistedState(KEY_VIDEO2_META, null);
  const [video3Meta, setVideo3Meta] = usePersistedState(KEY_VIDEO3_META, null);
  const [audioMeta, setAudioMeta] = usePersistedState(KEY_AUDIO_META, null);

  const [captionVideo, setCaptionVideo] = useState(null);
  const [captionFile, setCaptionFile] = useState(null);
  const [captionVideoMeta, setCaptionVideoMeta] = usePersistedState(KEY_CAPTION_VIDEO_META, null);
  const [captionFileMeta, setCaptionFileMeta] = usePersistedState(KEY_CAPTION_FILE_META, null);

  const [shortsVideo, setShortsVideo] = useState(null);
  const [shortsVideoMeta, setShortsVideoMeta] = usePersistedState(KEY_SHORTS_VIDEO_META, null);
  const [shortsDuration, setShortsDuration] = usePersistedState(KEY_SHORTS_DURATION, '60');
  const [shortsFormat, setShortsFormat] = usePersistedState(KEY_SHORTS_FORMAT, '9:16');
  const [shortsResults, setShortsResults] = useState(null);

  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(null);
  const [errorText, setErrorText] = useState(null);
  const [progress, setProgress] = useState({ percent: 0, currentTime: '' });
  const [socketId, setSocketId] = useState('');
  const [selectedShortId, setSelectedShortId] = useState(null);

  const [editorBannerVisible, setEditorBannerVisible] = useState(true);
  const [editorTimeline, setEditorTimeline] = useState([]);
  const [editorPlayhead, setEditorPlayhead] = useState(0);
  const [editorIsPlaying, setEditorIsPlaying] = useState(false);
  const [editorActiveClipIndex, setEditorActiveClipIndex] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(100);

  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewIsPlaying, setPreviewIsPlaying] = useState(false);

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

  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:3000');

    socket.on('connect', () => {
      setSocketId(socket.id);
    });

    socket.on('ffmpeg-progress', (payload) => {
      setProgress({
        percent: payload?.percent || 0,
        currentTime: payload?.currentTime || '',
      });
    });

    socket.on('disconnect', () => {
      setSocketId('');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

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
      if (clip.url) {
        URL.revokeObjectURL(clip.url);
      }
    });
  }, []);

  useEffect(() => {
    if (!editorVideoRef.current || editorTimeline.length === 0) {
      return;
    }

    let accumulatedTime = 0;
    for (let i = 0; i < editorTimeline.length; i += 1) {
      const clipDuration = editorTimeline[i].trimmedEnd - editorTimeline[i].trimmedStart;
      if (editorPlayhead >= accumulatedTime && editorPlayhead < accumulatedTime + clipDuration) {
        if (editorActiveClipIndex !== i) {
          setEditorActiveClipIndex(i);
          editorVideoRef.current.src = editorTimeline[i].url;
        }

        const localTarget = editorTimeline[i].trimmedStart + (editorPlayhead - accumulatedTime);
        if (Math.abs(editorVideoRef.current.currentTime - localTarget) > 0.2 && !editorIsPlaying) {
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

    setter(file);
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
      setAudio(null);
      setAudioMeta(null);
      return;
    }

    storeFileMeta(file, setAudio, setAudioMeta);
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
        setCaptionVideo(null);
        setCaptionVideoMeta(null);
        return;
      }
      storeFileMeta(file, setCaptionVideo, setCaptionVideoMeta);
    } else {
      if (!file.name.endsWith('.srt') && !file.name.endsWith('.vtt')) {
        setErrorText('Oops! Please upload a valid .srt or .vtt subtitle file.');
        event.target.value = '';
        setCaptionFile(null);
        setCaptionFileMeta(null);
        return;
      }
      storeFileMeta(file, setCaptionFile, setCaptionFileMeta);
    }

    setErrorText(null);
  };

  const handleMontageConvert = async () => {
    if (!video1 || !video2 || !video3 || !audio) {
      setErrorText('Please attach 3 Videos and 1 Audio track before exporting a Montage.');
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setResultUrl(null);
    setProgress({ percent: 0, currentTime: '' });

    const formData = new FormData();
    formData.append('video1', video1);
    formData.append('video2', video2);
    formData.append('video3', video3);
    formData.append('audio', audio);

    try {
      const response = await fetch(API_ENDPOINTS.convert, {
        method: 'POST',
        headers: socketId ? { 'X-Socket-Id': socketId } : {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
    } catch (error) {
      console.error(error);
      setErrorText(error.message || 'Error generating montage');
    } finally {
      setProcessing(false);
    }
  };

  const handleCaptionConvert = async () => {
    if (!captionVideo || !captionFile) {
      setErrorText('Please upload exactly 1 Video and 1 Subtitle file.');
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setResultUrl(null);
    setProgress({ percent: 0, currentTime: '' });

    const formData = new FormData();
    formData.append('video', captionVideo);
    formData.append('subtitle', captionFile);

    try {
      const response = await fetch(API_ENDPOINTS.burnSubtitles, {
        method: 'POST',
        headers: socketId ? { 'X-Socket-Id': socketId } : {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
    } catch (error) {
      console.error(error);
      setErrorText(error.message || 'Error burning subtitles');
    } finally {
      setProcessing(false);
    }
  };

  const handleShortsConvert = async () => {
    if (!shortsVideo) {
      setErrorText('Please upload a long-form video to extract shorts.');
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setShortsResults(null);
    setResultUrl(null);
    setProgress({ percent: 0, currentTime: '' });

    const formData = new FormData();
    formData.append('video', shortsVideo);
    formData.append('duration', shortsDuration);
    formData.append('aspectRatio', shortsFormat);

    try {
      const response = await fetch(API_ENDPOINTS.extractShorts, {
        method: 'POST',
        headers: socketId ? { 'X-Socket-Id': socketId } : {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = await response.json();
      setShortsResults(data.shorts);
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
      setVideo1(null);
      setVideo2(null);
      setVideo3(null);
      setAudio(null);
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
      setCaptionVideo(null);
      setCaptionFile(null);
      if (clearStorage) {
        setCaptionVideoMeta(null);
        setCaptionFileMeta(null);
      }
      if (captionVideoRef.current) captionVideoRef.current.value = '';
      if (captionRef.current) captionRef.current.value = '';
    } else if (activeTab === 'shorts') {
      setShortsVideo(null);
      if (clearStorage) {
        setShortsVideoMeta(null);
      }
      if (shortsVideoRef.current) shortsVideoRef.current.value = '';
      setShortsResults(null);
      setSelectedShortId(null);
    } else if (activeTab === 'editor') {
      editorTimeline.forEach((clip) => {
        if (clip.url) {
          URL.revokeObjectURL(clip.url);
        }
      });
      setEditorTimeline([]);
      setEditorPlayhead(0);
      setEditorActiveClipIndex(0);
      setEditorIsPlaying(false);
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
    if (removedClip?.url) {
      URL.revokeObjectURL(removedClip.url);
    }

    const nextTimeline = editorTimeline.filter((_clip, index) => index !== editorActiveClipIndex);
    setEditorTimeline(nextTimeline);
    setEditorActiveClipIndex(0);
    setEditorPlayhead(0);
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
    for (let i = 0; i < editorTimeline.length; i += 1) {
      const clipDuration = editorTimeline[i].trimmedEnd - editorTimeline[i].trimmedStart;
      if (editorPlayhead >= accumulatedTime && editorPlayhead < accumulatedTime + clipDuration) {
        if (editorActiveClipIndex !== i) {
          setEditorActiveClipIndex(i);
          editorVideoRef.current.src = editorTimeline[i].url;
          editorVideoRef.current.currentTime = editorTimeline[i].trimmedStart + (editorPlayhead - accumulatedTime);
        }
        break;
      }
      accumulatedTime += clipDuration;
    }

    editorVideoRef.current.play();
    setEditorIsPlaying(true);

    const updatePlayhead = () => {
      if (!editorVideoRef.current || editorVideoRef.current.ended) {
        setEditorIsPlaying(false);
        setEditorPlayhead(0);
        if (editorVideoRef.current) {
          editorVideoRef.current.currentTime = editorTimeline[0]?.trimmedStart || 0;
        }
        return;
      }

      const currentLocal = editorVideoRef.current.currentTime;
      let accumulated = 0;
      for (let i = 0; i < editorActiveClipIndex; i += 1) {
        accumulated += editorTimeline[i].trimmedEnd - editorTimeline[i].trimmedStart;
      }

      const newGlobalPlayhead = accumulated + (currentLocal - editorTimeline[editorActiveClipIndex].trimmedStart);
      setEditorPlayhead(newGlobalPlayhead);

      if (currentLocal >= editorTimeline[editorActiveClipIndex].trimmedEnd) {
        if (editorActiveClipIndex + 1 < editorTimeline.length) {
          const nextIndex = editorActiveClipIndex + 1;
          setEditorActiveClipIndex(nextIndex);
          editorVideoRef.current.src = editorTimeline[nextIndex].url;
          editorVideoRef.current.currentTime = editorTimeline[nextIndex].trimmedStart;
          editorVideoRef.current.play();
        } else {
          editorVideoRef.current.pause();
          setEditorIsPlaying(false);
          setEditorPlayhead(0);
          editorVideoRef.current.currentTime = editorTimeline[0]?.trimmedStart || 0;
          return;
        }
      }

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
    video1,
    video1Ref,
    setVideo1,
    video2,
    video2Ref,
    setVideo2,
    video3,
    video3Ref,
    setVideo3,
    handleVideoSelect,
    audio,
    audioRef,
    handleAudioSelect,
    video1Meta,
    setVideo1Meta,
    video2Meta,
    setVideo2Meta,
    video3Meta,
    setVideo3Meta,
    audioMeta,
  };

  const captionsProps = {
    captionVideo,
    captionVideoRef,
    captionFile,
    captionRef,
    handleCaptionSelect,
    captionVideoMeta,
    captionFileMeta,
  };

  const shortsProps = {
    shortsVideo,
    shortsVideoRef,
    handleVideoSelect,
    setShortsVideo,
    shortsVideoMeta,
    setShortsVideoMeta,
    duration: shortsDuration,
    setDuration: setShortsDuration,
    format: shortsFormat,
    setFormat: setShortsFormat,
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
            onImportClick: () => editorFileInputRef.current?.click(),
            onUpload: handleEditorUpload,
            fileInputRef: editorFileInputRef,
            videoRef: editorVideoRef,
            currentClip: editorTimeline[editorActiveClipIndex],
          }}
        />
        <RightPanel />
      </div>
      <BottomTimeline
        activeTab={activeTab}
        tracks={timelineTracks}
        currentTime={currentTime}
        totalDuration={effectiveTimelineDuration}
        zoom={timelineZoom}
        onZoomChange={setTimelineZoom}
        onSeek={handlePreviewSeek}
        onSplit={activeTab === 'editor' ? handleEditorSplit : undefined}
        onDelete={activeTab === 'editor' ? handleEditorDelete : undefined}
      />
      <ErrorPopup errorText={errorText} setErrorText={setErrorText} />
    </div>
  );
}

export default App;

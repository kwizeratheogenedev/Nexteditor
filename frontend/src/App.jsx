import { useState, useRef, useEffect } from 'react';
import { API_ENDPOINTS } from './config';
import { usePersistedState, clearPersistedState } from './hooks/usePersistedState';
import Sidebar from './components/Sidebar';
import Workspace from './components/Workspace';
import PreviewPanel from './components/PreviewPanel';
import ErrorPopup from './components/ErrorPopup';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = usePersistedState('nexeditor_activeTab', 'media');
  
  // Montage State - Store file metadata for persistence
  // Note: Actual file objects cannot be persisted, only metadata
  const [video1, setVideo1] = useState(null);
  const [video2, setVideo2] = useState(null);
  const [video3, setVideo3] = useState(null);
  const [audio, setAudio] = useState(null);
  
  // File metadata for persistence (shows what was uploaded)
  const [video1Meta, setVideo1Meta] = usePersistedState('nexeditor_video1_meta', null);
  const [video2Meta, setVideo2Meta] = usePersistedState('nexeditor_video2_meta', null);
  const [video3Meta, setVideo3Meta] = usePersistedState('nexeditor_video3_meta', null);
  const [audioMeta, setAudioMeta] = usePersistedState('nexeditor_audio_meta', null);

  // Caption State
  const [captionVideo, setCaptionVideo] = useState(null);
  const [captionFile, setCaptionFile] = useState(null);
  const [captionVideoMeta, setCaptionVideoMeta] = usePersistedState('nexeditor_captionVideo_meta', null);
  const [captionFileMeta, setCaptionFileMeta] = usePersistedState('nexeditor_captionFile_meta', null);
  
  // Shorts State
  const [shortsVideo, setShortsVideo] = useState(null);
  const [shortsVideoMeta, setShortsVideoMeta] = usePersistedState('nexeditor_shortsVideo_meta', null);
  const [shortsDuration, setShortsDuration] = usePersistedState('nexeditor_shortsDuration', '60');
  const [shortsFormat, setShortsFormat] = usePersistedState('nexeditor_shortsFormat', '9:16');
  const [shortsResults, setShortsResults] = useState(null);
  
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(null);
  const [errorText, setErrorText] = useState(null);

  // Check for previous session on mount
  useEffect(() => {
    const hasPreviousFiles = video1Meta || video2Meta || video3Meta || audioMeta || 
                           captionVideoMeta || captionFileMeta || shortsVideoMeta;
    
    if (hasPreviousFiles) {
      setErrorText("Welcome back! Please re-upload your files to continue where you left off.");
    }
  }, []);

  useEffect(() => {
    if (errorText) {
      const timer = setTimeout(() => setErrorText(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [errorText]);

  const video1Ref = useRef();
  const video2Ref = useRef();
  const video3Ref = useRef();
  const audioRef = useRef();
  
  const captionVideoRef = useRef();
  const captionRef = useRef();
  const shortsVideoRef = useRef();

  // Helper to store file metadata
  const storeFileMeta = (file, setter, metaSetter) => {
    if (file) {
      setter(file);
      metaSetter({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      });
    }
  };

  const handleVideoSelect = (e, setter, metaSetter, fieldName) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        setErrorText(`Oops! You selected a non-video file for ${fieldName}. Please upload a valid VIDEO file.`);
        e.target.value = '';
        setter(null);
        metaSetter(null);
        return;
      }
      storeFileMeta(file, setter, metaSetter);
      setErrorText(null);
    }
  };

  const handleAudioSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('audio/')) {
        setErrorText('Oops! Please upload a valid AUDIO file for the Soundtrack.');
        e.target.value = '';
        setAudio(null);
        setAudioMeta(null);
        return;
      }
      storeFileMeta(file, setAudio, setAudioMeta);
      setErrorText(null);
    }
  };

  const handleCaptionSelect = (e, isVideo) => {
    const file = e.target.files[0];
    if (file) {
      if (isVideo) {
        if (!file.type.startsWith('video/')) {
          setErrorText("Please upload a valid video file.");
          e.target.value = '';
          setCaptionVideo(null);
          setCaptionVideoMeta(null);
          return;
        }
        storeFileMeta(file, setCaptionVideo, setCaptionVideoMeta);
      } else {
        if (!file.name.endsWith('.srt') && !file.name.endsWith('.vtt')) {
          setErrorText('Oops! Please upload a valid .srt or .vtt subtitle file.');
          e.target.value = '';
          setCaptionFile(null);
          setCaptionFileMeta(null);
          return;
        }
        storeFileMeta(file, setCaptionFile, setCaptionFileMeta);
      }
      setErrorText(null);
    }
  };

  const handleMontageConvert = async () => {
    if (!video1 || !video2 || !video3 || !audio) {
      setErrorText("Please attach 3 Videos and 1 Audio track before exporting a Montage.");
      return;
    }

    setProcessing(true);
    setErrorText(null);
    setResultUrl(null);

    const formData = new FormData();
    formData.append('video1', video1);
    formData.append('video2', video2);
    formData.append('video3', video3);
    formData.append('audio', audio);

    try {
      const response = await fetch(API_ENDPOINTS.convert, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
    } catch (err) {
      console.error(err);
      setErrorText(err.message || 'Error generating montage');
    } finally {
      setProcessing(false);
    }
  };

  const handleCaptionConvert = async () => {
    if (!captionVideo || !captionFile) {
        setErrorText("Please upload exactly 1 Video and 1 Subtitle file.");
        return;
    }

    setProcessing(true);
    setErrorText(null);
    setResultUrl(null);

    const formData = new FormData();
    formData.append('video', captionVideo);
    formData.append('subtitle', captionFile);

    try {
      const response = await fetch(API_ENDPOINTS.burnSubtitles, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
    } catch (err) {
      console.error(err);
      setErrorText(err.message || 'Error burning subtitles');
    } finally {
      setProcessing(false);
    }
  };

  const handleShortsConvert = async () => {
    if (!shortsVideo) {
        setErrorText("Please upload a long-form video to extract shorts.");
        return;
    }
    setProcessing(true);
    setErrorText(null);
    setShortsResults(null);
    setResultUrl(null);

    const formData = new FormData();
    formData.append('video', shortsVideo);
    formData.append('duration', shortsDuration);
    formData.append('aspectRatio', shortsFormat);

    try {
      const response = await fetch(API_ENDPOINTS.extractShorts, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setShortsResults(data.shorts);
    } catch (err) {
      console.error(err);
      setErrorText(err.message || 'Error extracting shorts');
    } finally {
      setProcessing(false);
    }
  };

  const handleReformat = async (clipData, formatStrategy) => {
    try {
        const res = await fetch(API_ENDPOINTS.reformatShort, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                originalVideo: clipData.originalVideo,
                startTime: clipData.startTime,
                duration: clipData.duration,
                formatStrategy: formatStrategy,
                aspectRatio: clipData.aspectRatio,
                id: clipData.id
            })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        
        setShortsResults(prev => prev.map(clip => clip.id === clipData.id ? data : clip));
    } catch(err) {
        setErrorText(err.message || "Failed to reformat clip");
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
    } catch (err) {
      console.error(err);
      setErrorText(err.message || 'Failed to download clip');
    }
  };

  const handleConvert = async (e) => {
    e.preventDefault();
    if (activeTab === 'media') {
       await handleMontageConvert();
    } else if (activeTab === 'captions') {
       await handleCaptionConvert();
    } else if (activeTab === 'shorts') {
       await handleShortsConvert();
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
    }
    
    setResultUrl(null);
    if (clearStorage) {
        setErrorText(null);
    }
  };

  const mediaProps = {
    video1, video1Ref, setVideo1,
    video2, video2Ref, setVideo2,
    video3, video3Ref, setVideo3,
    handleVideoSelect,
    audio, audioRef, handleAudioSelect,
    // Metadata for persistence
    video1Meta, setVideo1Meta,
    video2Meta, setVideo2Meta,
    video3Meta, setVideo3Meta,
    audioMeta, setAudioMeta
  };

  const captionsProps = {
    captionVideo, captionVideoRef, handleVideoSelect, setCaptionVideo,
    captionFile, captionRef, handleCaptionSelect,
    captionVideoMeta, setCaptionVideoMeta,
    captionFileMeta, setCaptionFileMeta
  };

  const shortsProps = {
    shortsVideo, shortsVideoRef, handleVideoSelect, setShortsVideo,
    shortsVideoMeta, setShortsVideoMeta,
    duration: shortsDuration, setDuration: setShortsDuration,
    format: shortsFormat, setFormat: setShortsFormat
  };

  return (
    <div className={`dashboard-container ${activeTab === 'editor' ? 'editor-mode' : ''}`}>
      <div className="background-decoration">
         <div className="blob blob-1"></div>
         <div className="blob blob-2"></div>
      </div>

      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <Workspace 
        activeTab={activeTab}
        mediaProps={mediaProps}
        captionsProps={captionsProps}
        shortsProps={shortsProps}
      />

      {activeTab !== 'editor' && (
        <PreviewPanel 
          processing={processing} 
          handleConvert={handleConvert} 
          resultUrl={resultUrl} 
          shortsResults={shortsResults}
          handleReset={() => handleReset(true)} 
          handleReformat={handleReformat}
          handleShortDownload={handleShortDownload}
        />
      )}

      <ErrorPopup errorText={errorText} setErrorText={setErrorText} />
    </div>
  );
}

export default App;

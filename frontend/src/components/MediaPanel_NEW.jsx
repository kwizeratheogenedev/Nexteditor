import { useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import API_BASE_URL from '../config.js';
import './MediaPanel.css';

/**
 * Detect URL type from a URL string
 */
function detectUrlType(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    }
    if (hostname.includes('drive.google.com')) {
      return 'gdrive';
    }
    if (hostname.includes('dropbox.com')) {
      return 'dropbox';
    }

    return 'direct';
  } catch {
    return null;
  }
}

/**
 * Get icon for URL type
 */
function getUrlTypeIcon(type) {
  const icons = {
    youtube: '🎬',
    gdrive: '📂',
    dropbox: '📦',
    direct: '🔗',
  };
  return icons[type] || '🔗';
}

/**
 * Get label for URL type
 */
function getUrlTypeLabel(type) {
  const labels = {
    youtube: 'YouTube',
    gdrive: 'Google Drive',
    dropbox: 'Dropbox',
    direct: 'Direct URL',
  };
  return labels[type] || 'Link';
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format duration for display
 */
function formatDuration(seconds) {
  if (!seconds) return '';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Individual media field card component
 */
function MediaFieldCard({
  label,
  fieldName,
  state,
  setState,
  socketId,
  isProcessing,
  onError,
  fileInputRef,
}) {
  const urlInputRef = useRef(null);
  const fetchButtonRef = useRef(null);
  const { socket } = useSocket();

  // Set up Socket.IO listeners for URL fetch progress
  useEffect(() => {
    if (!socketId || !socket) return undefined;

    const handleUrlProgress = (payload) => {
      setState((prev) => ({
        ...prev,
        progress: payload.percent || 0,
      }));
    };

    const handleUrlError = (payload) => {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: payload.error || 'Failed to fetch URL',
        progress: 0,
      }));
      onError?.(payload.error || 'Failed to fetch URL');
    };

    socket.on('url-fetch-progress', handleUrlProgress);
    socket.on('url-fetch-error', handleUrlError);

    return () => {
      socket.off('url-fetch-progress', handleUrlProgress);
      socket.off('url-fetch-error', handleUrlError);
    };
  }, [socketId, socket, setState, onError]);

  // Handle file selection (device upload)
  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      onError?.(`Please select a valid video or audio file for ${label}`);
      event.target.value = '';
      return;
    }

    // Get duration from video/audio element
    const mediaElement = document.createElement(fieldName.includes('Audio') ? 'audio' : 'video');
    mediaElement.src = URL.createObjectURL(file);
    mediaElement.onloadedmetadata = () => {
      setState((prev) => ({
        ...prev,
        file,
        fileName: file.name,
        duration: mediaElement.duration,
        filePath: '', // Clear filePath since we're using file object
        status: 'ready',
        error: '',
        progress: 0,
      }));
      URL.revokeObjectURL(mediaElement.src);
    };
    mediaElement.onerror = () => {
      onError?.(`Failed to load ${label}`);
      event.target.value = '';
    };
  };

  // Handle URL fetch
  const handleFetchUrl = async () => {
    const url = state.url.trim();
    if (!url) {
      onError?.('Please enter a URL');
      return;
    }

    const urlType = detectUrlType(url);
    if (!urlType) {
      onError?.('Invalid URL format');
      return;
    }

    setState((prev) => ({
      ...prev,
      status: 'loading',
      progress: 0,
      error: '',
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/api/fetch-url-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-socket-id': socketId,
        },
        body: JSON.stringify({
          url,
          socketId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch URL');
      }

      const data = await response.json();

      setState((prev) => ({
        ...prev,
        filePath: data.filePath,
        fileName: data.fileName || `${urlType}-video`,
        duration: parseFloat(data.duration) || 0,
        status: 'ready',
        progress: 100,
        error: '',
        file: null, // Clear file object since we're using backend path
      }));
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch URL';
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: errorMsg,
        progress: 0,
      }));
      onError?.(errorMsg);
    }
  };

  // Handle keyboard press (Enter to fetch)
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && state.sourceMode === 'url' && !isProcessing) {
      handleFetchUrl();
    }
  };

  // Handle clear/reset
  const handleClear = () => {
    setState((prev) => ({
      ...prev,
      sourceMode: 'device',
      file: null,
      url: '',
      filePath: '',
      fileName: '',
      duration: null,
      status: 'idle',
      progress: 0,
      error: '',
    }));
    if (fileInputRef?.current) {
      fileInputRef.current.value = '';
    }
    if (urlInputRef?.current) {
      urlInputRef.current.value = '';
    }
  };

  return (
    <div className="media-field-card">
      <div className="media-field-header">
        <span className="media-field-label">{label}</span>
        {state.status === 'ready' && (
          <button
            type="button"
            className="media-field-clear-btn"
            onClick={handleClear}
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {/* Source selector toggle */}
      <div className="media-field-source-selector">
        <button
          type="button"
          className={`source-tab ${state.sourceMode === 'device' ? 'active' : ''}`}
          onClick={() => setState((prev) => ({ ...prev, sourceMode: 'device' }))}
        >
          📁 From Device
        </button>
        <button
          type="button"
          className={`source-tab ${state.sourceMode === 'url' ? 'active' : ''}`}
          onClick={() => setState((prev) => ({ ...prev, sourceMode: 'url' }))}
        >
          🔗 From URL
        </button>
      </div>

      {/* Content based on source mode */}
      <div className="media-field-content">
        {state.sourceMode === 'device' && (
          <div className="device-input-section">
            <button
              type="button"
              className="device-upload-btn"
              onClick={() => fileInputRef?.current?.click()}
              disabled={state.status === 'loading' || isProcessing}
            >
              Choose File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={fieldName.includes('Audio') ? 'audio/*' : 'video/*'}
              onChange={handleFileSelect}
              className="sr-only"
            />
          </div>
        )}

        {state.sourceMode === 'url' && (
          <div className="url-input-section">
            <div className="url-input-wrapper">
              <input
                ref={urlInputRef}
                type="url"
                className="url-input"
                placeholder="Paste YouTube, Drive, Dropbox or direct URL..."
                value={state.url}
                onChange={(e) => setState((prev) => ({ ...prev, url: e.target.value }))}
                onKeyPress={handleKeyPress}
                disabled={state.status === 'loading' || isProcessing}
              />
              {state.url && detectUrlType(state.url) && (
                <span className="url-type-indicator" title={getUrlTypeLabel(detectUrlType(state.url))}>
                  {getUrlTypeIcon(detectUrlType(state.url))}
                </span>
              )}
            </div>
            <button
              ref={fetchButtonRef}
              type="button"
              className="fetch-btn"
              onClick={handleFetchUrl}
              disabled={state.status === 'loading' || isProcessing || !state.url.trim()}
            >
              {state.status === 'loading' ? 'Downloading...' : 'Fetch'}
            </button>
          </div>
        )}

        {/* Progress bar */}
        {state.status === 'loading' && (
          <div className="progress-section">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${state.progress}%` }} />
            </div>
            <span className="progress-text">{state.progress}%</span>
          </div>
        )}

        {/* Error message */}
        {state.status === 'error' && (
          <div className="error-message">
            {state.error}
          </div>
        )}

        {/* Ready state: show file info */}
        {state.status === 'ready' && (
          <div className="ready-section">
            <div className="file-info-row">
              <span className="file-name">✓ {state.fileName}</span>
            </div>
            {state.duration && (
              <div className="file-info-row">
                <span className="file-meta">Duration: {formatDuration(state.duration)}</span>
              </div>
            )}
            {state.file && (
              <div className="file-info-row">
                <span className="file-meta">Size: {formatFileSize(state.file.size)}</span>
              </div>
            )}
          </div>
        )}

        {/* Idle state: show hint */}
        {state.status === 'idle' && (
          <div className="idle-hint">
            {state.sourceMode === 'device'
              ? 'Click "Choose File" to select a video or audio file'
              : 'Paste a URL and click "Fetch" to download'}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Main MediaPanel component
 */
function MediaPanel({
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
  onError,
}) {
  const video1FileInputRef = useRef(null);
  const video2FileInputRef = useRef(null);
  const video3FileInputRef = useRef(null);
  const audioFileInputRef = useRef(null);

  return (
    <div className="media-panel-container">
      <div className="media-panel-grid">
        <MediaFieldCard
          label="Video 1"
          fieldName="video1"
          state={video1State}
          setState={setVideo1State}
          socketId={socketId}
          isProcessing={processing}
          onError={onError}
          fileInputRef={video1FileInputRef}
        />

        <MediaFieldCard
          label="Video 2"
          fieldName="video2"
          state={video2State}
          setState={setVideo2State}
          socketId={socketId}
          isProcessing={processing}
          onError={onError}
          fileInputRef={video2FileInputRef}
        />

        <MediaFieldCard
          label="Video 3"
          fieldName="video3"
          state={video3State}
          setState={setVideo3State}
          socketId={socketId}
          isProcessing={processing}
          onError={onError}
          fileInputRef={video3FileInputRef}
        />

        <MediaFieldCard
          label="Audio"
          fieldName="audio"
          state={audioState}
          setState={setAudioState}
          socketId={socketId}
          isProcessing={processing}
          onError={onError}
          fileInputRef={audioFileInputRef}
        />
      </div>
    </div>
  );
}

export default MediaPanel;

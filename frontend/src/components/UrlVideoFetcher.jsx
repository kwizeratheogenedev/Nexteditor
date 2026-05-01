import { useState, useRef } from 'react';
import './UrlVideoFetcher.css';

/**
 * Detects the video source type from URL
 * Returns: 'youtube' | 'gdrive' | 'dropbox' | 'direct'
 */
function detectSourceType(url) {
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
 * Returns icon/emoji based on source type
 */
function getSourceIcon(sourceType) {
  const icons = {
    youtube: '▶️',
    gdrive: '☁️',
    dropbox: '📦',
    direct: '🔗',
  };
  return icons[sourceType] || '🔗';
}

function UrlVideoFetcher({
  label,
  onSuccess,
  onError,

  isLoading,
}) {
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [isFetching, setIsFetching] = useState(false);
  const sourceType = detectSourceType(url);
  const socketRef = useRef(null);

  /**
   * Set up Socket.IO listener for progress updates
   */
  const setupSocketListener = (socket) => {
    if (socketRef.current) {
      socketRef.current.off('url-fetch-progress');
      socketRef.current.off('url-fetch-error');
    }

    socketRef.current = socket;
    socket.on('url-fetch-progress', (payload) => {
      setProgress(payload.percent || 0);
    });

    socket.on('url-fetch-error', (payload) => {
      setProgress(0);
      onError(payload.error || 'Failed to fetch URL');
    });
  };

  const handleFetch = async () => {
    if (!url.trim()) {
      onError('Please enter a video URL');
      return;
    }

    if (!sourceType) {
      onError('Invalid URL. Please check the format.');
      return;
    }

    setIsFetching(true);
    setProgress(0);

    try {
      // Import socket dynamically to get current instance
      const { io } = await import('socket.io-client');
      const socket = io(import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:3000');

      // Wait for socket to connect
      await new Promise((resolve) => {
        if (socket.connected) {
          resolve();
        } else {
          socket.once('connect', resolve);
        }
      });

      setupSocketListener(socket);

      // Call backend API
      const response = await fetch('http://localhost:3000/api/fetch-url-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-socket-id': socket.id,
        },
        body: JSON.stringify({
          url: url.trim(),
          socketId: socket.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch URL');
      }

      const data = await response.json();

      // Clean up socket listener
      socketRef.current?.off('url-fetch-progress');
      socketRef.current?.off('url-fetch-error');
      socket.disconnect();

      setUrl('');
      setProgress(0);
      onSuccess(data);
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch video';
      setProgress(0);
      onError(errorMsg);
    } finally {
      setIsFetching(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !isFetching && url.trim()) {
      handleFetch();
    }
  };

  return (
    <div className="url-fetcher-container">
      <div className="file-card">
        <span className="property-label">{label}</span>
        <div className="url-input-wrapper">
          <input
            type="url"
            className="source-input"
            placeholder="Paste YouTube, Google Drive, Dropbox, or direct video URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isFetching || isLoading}
          />
          {sourceType && (
            <span className="source-indicator" title={sourceType}>
              {getSourceIcon(sourceType)}
            </span>
          )}
        </div>

        {isFetching && (
          <div className="fetch-progress-container">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="progress-text">{progress}%</span>
          </div>
        )}

        <button
          type="button"
          className="fetch-button"
          onClick={handleFetch}
          disabled={isFetching || isLoading || !url.trim()}
        >
          {isFetching ? 'Downloading...' : 'Fetch Video'}
        </button>

        <small className="file-card-meta">
          ✓ YouTube • ✓ Google Drive • ✓ Dropbox • ✓ Direct URLs
        </small>
      </div>
    </div>
  );
}

export default UrlVideoFetcher;

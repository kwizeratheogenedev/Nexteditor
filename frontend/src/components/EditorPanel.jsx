import { useEffect, useMemo, useRef, useState } from 'react';
import './EditorWorkspace.css';
import { isVideoLikeClip, isImageClip } from '../timeline/clipKinds';
import { getWaveformForClip, sliceWaveform } from '../timeline/waveform';
import { formatTimecode, formatShortDuration } from '../timeline/timecode';

const Icon = ({ d, size = 18, strokeWidth = 1.8, filled = false }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICON = {
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  image: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5 M15 9h.01',
  play: 'M7 4v16l13-8z',
  pause: 'M7 4h4v16H7z M13 4h4v16h-4z',
  fullscreen: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  upload: 'M12 16V4 M7 9l5-5 5 5 M5 20h14',
};

// Maps a client (mouse) position to the canvas's on-screen content box,
// accounting for the canvas being letterboxed via object-fit:contain.
function getCanvasContentRect(canvasEl) {
  const rect = canvasEl.getBoundingClientRect();
  const canvasAspect = canvasEl.width / canvasEl.height;
  const boxAspect = rect.width / rect.height;
  let width;
  let height;
  if (boxAspect > canvasAspect) {
    height = rect.height;
    width = rect.height * canvasAspect;
  } else {
    width = rect.width;
    height = rect.width / canvasAspect;
  }
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

function clipName(clip, fallback) {
  return clip.file?.name || clip.label || (clip.url || clip.remoteUrl || '').split('/').pop()?.split('?')[0] || fallback;
}

// A green waveform tile for audio in the media bin, drawn from the same
// decoded peaks the timeline uses (timeline/waveform.js caches per source).
function AudioThumb({ clip }) {
  const canvasRef = useRef(null);
  const [waveform, setWaveform] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getWaveformForClip(clip).then((result) => { if (!cancelled) setWaveform(result); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.sourceId]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const width = 160;
    const height = 80;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const bars = 40;
    const peaks = sliceWaveform(waveform, 0, waveform.duration, bars);
    ctx.fillStyle = '#6ee7a8';
    const gap = 1.5;
    const barWidth = width / bars - gap;
    for (let i = 0; i < bars; i += 1) {
      const amp = Math.max(0.12, Math.min(1, peaks[i] * 3.2));
      const h = amp * (height - 16);
      ctx.fillRect(i * (barWidth + gap) + gap / 2, (height - h) / 2, barWidth, h);
    }
  }, [waveform]);
  return <canvas ref={canvasRef} className="st-media-wave" aria-hidden="true" />;
}

function EditorPanel({
  timeline, audioClips = [], selectedClipId, selectedClip, onSelectClip, onImportClick, onUpload, onImportFiles, onImportUrl, fileInputRef,
  canvasRef, isPlaying, currentTime, videoDuration, onTogglePlayback, onMoveOverlay, onMoveOverlayEnd,
  canvasSize, onFullscreen, mediaFocus,
}) {
  // 'player' shows the editable view (drag handles on a selected overlay
  // clip); 'preview' is the clean composited frame with no edit chrome.
  const [viewMode, setViewMode] = useState('player');
  // 'fit' scales the canvas to the stage; '100' shows true pixel size.
  const [zoomMode, setZoomMode] = useState('fit');
  const [link, setLink] = useState('');
  const [linkState, setLinkState] = useState({ status: 'idle', message: '' });
  const [dragOver, setDragOver] = useState(false);
  const mediaRef = useRef(null);
  const fps = canvasSize?.fps || 30;

  // One card per imported SOURCE, not one per timeline clip - split,
  // duplicate and freeze-frame add clips that reference the same file.
  const mediaItems = useMemo(() => {
    const bySource = new Map();
    [...timeline.filter((clip) => isVideoLikeClip(clip)), ...audioClips].forEach((clip) => {
      const key = clip.sourceId || clip.id;
      if (!bySource.has(key)) bySource.set(key, clip);
    });
    return [...bySource.values()];
  }, [timeline, audioClips]);
  const hasContent = timeline.length > 0;
  const overlayDragRef = useRef(null);

  // Pressing "Media" in the sidebar brings the bin into focus.
  useEffect(() => {
    if (mediaFocus) mediaRef.current?.focus();
  }, [mediaFocus]);

  const isOverlayClip = viewMode === 'player' && selectedClip && isVideoLikeClip(selectedClip) && (selectedClip.trackIndex || 0) > 0;

  const handleOverlayDragMove = (event) => {
    const drag = overlayDragRef.current;
    if (!drag) return;
    const deltaPercentX = ((event.clientX - drag.startClientX) * 200) / drag.contentWidth;
    const deltaPercentY = ((event.clientY - drag.startClientY) * 200) / drag.contentHeight;
    onMoveOverlay?.(selectedClipId, drag.originX + deltaPercentX, drag.originY + deltaPercentY);
  };

  const handleOverlayDragEnd = () => {
    overlayDragRef.current = null;
    window.removeEventListener('mousemove', handleOverlayDragMove);
    window.removeEventListener('mouseup', handleOverlayDragEnd);
    onMoveOverlayEnd?.();
  };

  // Only a clip on an overlay lane can be dragged around the frame - it
  // writes the same transform.x/y the inspector's Position sliders use.
  const handleOverlayDragStart = (event) => {
    if (!isOverlayClip || !canvasRef.current) return;
    event.preventDefault();
    const content = getCanvasContentRect(canvasRef.current);
    overlayDragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      contentWidth: content.width,
      contentHeight: content.height,
      originX: selectedClip.transform?.x || 0,
      originY: selectedClip.transform?.y || 0,
    };
    window.addEventListener('mousemove', handleOverlayDragMove);
    window.addEventListener('mouseup', handleOverlayDragEnd);
  };

  const handleFetch = async (event) => {
    event.preventDefault();
    const url = link.trim();
    if (!url || linkState.status === 'loading') return;
    setLinkState({ status: 'loading', message: 'Fetching…' });
    try {
      await onImportUrl?.(url, (message) => setLinkState({ status: 'loading', message }));
      setLink('');
      setLinkState({ status: 'idle', message: '' });
    } catch (err) {
      setLinkState({ status: 'error', message: err.message || 'Could not fetch that link.' });
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    const files = [...(event.dataTransfer?.files || [])].filter((file) => /^(video|audio|image)\//.test(file.type));
    if (files.length) onImportFiles?.(files);
  };

  const dropProps = {
    onDragOver: (event) => { event.preventDefault(); if (!dragOver) setDragOver(true); },
    onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); },
    onDrop: handleDrop,
  };

  return (
    <div className="st-editor">
      <aside className="st-media" ref={mediaRef} tabIndex={-1} aria-label="Media" {...dropProps}>
        <header className="st-media-head">
          <h2>Media</h2>
          <button type="button" className="st-chip-btn" onClick={onImportClick}>+ Import</button>
        </header>
        <input ref={fileInputRef} type="file" accept="video/*,audio/*,image/*" multiple onChange={onUpload} className="sr-only-input" />

        <form className={`st-link ${linkState.status === 'error' ? 'is-error' : ''}`} onSubmit={handleFetch}>
          <Icon d={ICON.link} size={16} />
          <input
            type="url"
            value={link}
            onChange={(event) => { setLink(event.target.value); if (linkState.status === 'error') setLinkState({ status: 'idle', message: '' }); }}
            placeholder="Paste a YouTube, TikTok or Drive link"
            aria-label="Video link"
            disabled={linkState.status === 'loading'}
          />
          <button type="submit" disabled={!link.trim() || linkState.status === 'loading'}>
            {linkState.status === 'loading' ? <span className="st-spin" aria-label="Fetching" /> : 'Fetch'}
          </button>
        </form>
        {linkState.message && <p className={`st-link-status ${linkState.status === 'error' ? 'is-error' : ''}`} role="status">{linkState.message}</p>}

        {mediaItems.length ? (
          <div className="st-media-grid">
            {mediaItems.map((clip, index) => {
              const audio = clip.type === 'audio';
              const length = clip.duration || (clip.trimmedEnd - clip.trimmedStart) || 0;
              return (
                <button
                  type="button"
                  key={clip.id}
                  className={`st-media-card ${selectedClipId === clip.id ? 'is-active' : ''}`}
                  onClick={() => onSelectClip?.(clip.id)}
                  title={clipName(clip, `Clip ${index + 1}`)}
                >
                  <span className={`st-media-thumb ${audio ? 'is-audio' : ''}`}>
                    {audio ? <AudioThumb clip={clip} />
                      : isImageClip(clip) ? <img src={clip.url || clip.remoteUrl} alt="" />
                        : <video src={clip.url || clip.remoteUrl} muted preload="metadata" />}
                    {clip.file?.nexFromLink ? <em className="st-badge-link">From link</em>
                      : !isImageClip(clip) && length > 0 && <em className="st-badge-time">{formatShortDuration(length)}</em>}
                  </span>
                  <span className="st-media-name">{clipName(clip, `Clip ${index + 1}`)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <button type="button" className="st-media-empty" onClick={onImportClick}>
            <Icon d={ICON.upload} size={20} />
            <strong>Import media</strong>
            <small>Video, audio or images - or drop files here</small>
          </button>
        )}
      </aside>

      <section className="st-stage-col">
        <div className={`st-stage ${dragOver ? 'is-drag' : ''}`} {...dropProps}>
          {hasContent ? (
            <div
              className={`st-frame ${zoomMode === '100' ? 'is-actual' : ''}`}
              style={zoomMode === '100'
                ? { width: canvasSize?.width || 1920, height: canvasSize?.height || 1080 }
                : { '--ar': (canvasSize?.width || 16) / (canvasSize?.height || 9) }}
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleOverlayDragStart}
                style={{ cursor: isOverlayClip ? 'move' : 'default' }}
              />
              {isOverlayClip && (
                <>
                  <span className="st-corner is-tl" /><span className="st-corner is-tr" /><span className="st-corner is-bl" /><span className="st-corner is-br" />
                </>
              )}
            </div>
          ) : (
            <button type="button" className="st-drop" onClick={onImportClick}>
              <Icon d={ICON.image} size={34} strokeWidth={1.5} />
              <span>Drop media here</span>
              <small>or click to import</small>
            </button>
          )}
          {hasContent && (
            <div className="st-stage-tools" role="toolbar" aria-label="Viewer">
              <button type="button" className={viewMode === 'player' ? 'is-active' : ''} onClick={() => setViewMode('player')} title="Editable view">Player</button>
              <button type="button" className={viewMode === 'preview' ? 'is-active' : ''} onClick={() => setViewMode('preview')} title="Clean view of the frame, no handles">Preview</button>
              <i />
              <button type="button" className={zoomMode === 'fit' ? 'is-active' : ''} onClick={() => setZoomMode('fit')}>Fit</button>
              <button type="button" className={zoomMode === '100' ? 'is-active' : ''} onClick={() => setZoomMode('100')} title="True pixel size">100%</button>
            </div>
          )}
        </div>
        <div className="st-transport">
          <button type="button" className="st-play" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={onTogglePlayback} disabled={!hasContent}>
            <Icon d={isPlaying ? ICON.pause : ICON.play} size={15} filled />
          </button>
          <span className="st-timecode">{formatTimecode(currentTime, fps)} / {formatTimecode(videoDuration, fps)}</span>
          {hasContent && onFullscreen && (
            <button type="button" className="st-fullscreen" aria-label="Fullscreen" title="Fullscreen" onClick={onFullscreen}>
              <Icon d={ICON.fullscreen} size={15} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export default EditorPanel;

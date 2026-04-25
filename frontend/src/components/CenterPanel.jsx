import MediaPanel from './MediaPanel';
import CaptionsPanel from './CaptionsPanel';
import ShortsPanel from './ShortsPanel';
import EditorPanel from './EditorPanel';

function formatTimecode(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '00:00';
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getModePanel(activeTab, mediaProps, captionsProps, shortsProps) {
  if (activeTab === 'media') {
    return <MediaPanel {...mediaProps} />;
  }
  if (activeTab === 'captions') {
    return <CaptionsPanel {...captionsProps} />;
  }
  if (activeTab === 'shorts') {
    return <ShortsPanel {...shortsProps} />;
  }
  return null;
}

function CenterPanel({
  activeTab,
  mediaProps,
  captionsProps,
  shortsProps,
  resultUrl,
  shortsResults,
  selectedShortId,
  onSelectShort,
  processing,
  progress,
  handleReset,
  handleReformat,
  handleShortDownload,
  previewSrc,
  previewVideoRef,
  previewCurrentTime,
  previewDuration,
  previewIsPlaying,
  onPreviewMetadata,
  onPreviewTimeUpdate,
  onPreviewPlay,
  onPreviewPause,
  onTogglePlayback,
  onSeek,
  onStep,
  onFullscreen,
  editorProps,
}) {
  const filledWidth = previewDuration > 0 ? `${(previewCurrentTime / previewDuration) * 100}%` : '0%';
  const modePanel = getModePanel(activeTab, mediaProps, captionsProps, shortsProps);

  return (
    <section className="center-panel">
      <div className="preview-area">
        {activeTab === 'editor' ? (
          <EditorPanel {...editorProps} />
        ) : (
          <div className="mode-stage">
            {previewSrc ? (
              <div className="preview-stage-video">
                <video
                  ref={previewVideoRef}
                  className="preview-video"
                  src={previewSrc}
                  controls={false}
                  onLoadedMetadata={onPreviewMetadata}
                  onTimeUpdate={onPreviewTimeUpdate}
                  onPlay={onPreviewPlay}
                  onPause={onPreviewPause}
                />
              </div>
            ) : (
              <div className="preview-dropzone">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 4v10M8 8l4-4 4 4M5 15.5V18h14v-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p>Drop video here or click to upload</p>
              </div>
            )}

            <div className="mode-panel-host">
              {modePanel}
            </div>

            {(processing || progress.percent > 0 || resultUrl || shortsResults?.length) && (
              <div className="center-status-strip">
                <div className="status-pill">
                  <span className="property-label">Progress</span>
                  <div className="progress-inline">
                    <div className="progress-inline-bar">
                      <span style={{ width: `${progress.percent || 0}%` }} />
                    </div>
                    <strong>{Math.round(progress.percent || 0)}%</strong>
                  </div>
                  <small>{progress.currentTime || 'Idle'}</small>
                </div>

                {resultUrl && (
                  <div className="status-actions">
                    <a href={resultUrl} download="NexEditor_Export.mp4" className="timeline-action-button timeline-action-accent">Download</a>
                    <button type="button" className="timeline-action-button" onClick={() => handleReset(true)}>Reset</button>
                  </div>
                )}
              </div>
            )}

            {shortsResults?.length ? (
              <div className="shorts-strip">
                {shortsResults.map((clip, index) => (
                  <div
                    key={clip.id}
                    className={`short-card ${selectedShortId === clip.id ? 'is-selected' : ''}`}
                  >
                    <button type="button" className="short-card-preview" onClick={() => onSelectShort(clip.id)}>
                      <video src={clip.url} muted />
                      <span>{`Clip ${index + 1}`}</span>
                    </button>
                    <div className="short-card-actions">
                      <button type="button" className="timeline-action-button" onClick={() => handleShortDownload(clip, index)}>Download</button>
                      <button
                        type="button"
                        className="timeline-action-button"
                        onClick={() => handleReformat(clip, clip.formatStrategy === 'crop' ? 'letterbox' : 'crop')}
                      >
                        {clip.formatStrategy === 'crop' ? 'Letterbox' : 'Center Crop'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="preview-controls">
        <div className="transport-group">
          <button type="button" className="transport-button" onClick={() => onSeek(0)}>⏮</button>
          <button type="button" className="transport-button" onClick={() => onStep(-2)}>⏪</button>
          <button type="button" className="transport-button is-play" onClick={onTogglePlayback}>
            {previewIsPlaying ? '⏸' : '▶'}
          </button>
          <button type="button" className="transport-button" onClick={() => onStep(2)}>⏩</button>
          <button type="button" className="transport-button" onClick={() => onSeek(previewDuration || 0)}>⏭</button>
        </div>

        <div className="timecode-display">{`${formatTimecode(previewCurrentTime)} / ${formatTimecode(previewDuration)}`}</div>

        <button
          type="button"
          className="progress-track"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const percent = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
            onSeek((previewDuration || 0) * Math.max(0, Math.min(percent, 1)));
          }}
        >
          <span className="progress-track-fill" style={{ width: filledWidth }} />
        </button>

        <button type="button" className="transport-button" onClick={onFullscreen}>⛶</button>
      </div>
    </section>
  );
}

export default CenterPanel;

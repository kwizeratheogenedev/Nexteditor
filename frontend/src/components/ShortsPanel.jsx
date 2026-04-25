function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ShortsPanel({
  shortsVideo,
  shortsVideoRef,
  handleVideoSelect,
  setShortsVideo,
  shortsVideoMeta,
  setShortsVideoMeta,
  duration,
  setDuration,
  format,
  setFormat,
}) {
  return (
    <div className="mode-grid mode-grid-single">
      <div className="file-card">
        <span className="property-label">Source Video</span>
        <button type="button" className="file-card-button" onClick={() => shortsVideoRef.current?.click()}>
          {shortsVideo || shortsVideoMeta ? 'Replace Video' : 'Import Video'}
        </button>
        <div className="file-card-name">{shortsVideo ? shortsVideo.name : shortsVideoMeta?.name || 'No file selected'}</div>
        {shortsVideoMeta && !shortsVideo ? <small className="file-card-meta">{`Previous: ${formatFileSize(shortsVideoMeta.size)}`}</small> : null}
        <input type="file" accept="video/*" ref={shortsVideoRef} onChange={(event) => handleVideoSelect(event, setShortsVideo, setShortsVideoMeta, 'Source Video')} className="sr-only-input" />
      </div>

      <div className="file-card">
        <span className="property-label">Platform Orientation</span>
        <div className="toggle-pair">
          <button type="button" className={`mini-toggle ${format === '9:16' ? 'is-active' : ''}`} onClick={() => setFormat('9:16')}>TikTok / Reels</button>
          <button type="button" className={`mini-toggle ${format === '16:9' ? 'is-active' : ''}`} onClick={() => setFormat('16:9')}>YouTube</button>
        </div>
      </div>

      <div className="file-card">
        <span className="property-label">Target Duration</span>
        <div className="toggle-pair">
          <button type="button" className={`mini-toggle ${duration === '60' ? 'is-active' : ''}`} onClick={() => setDuration('60')}>{'< 1 Min'}</button>
          <button type="button" className={`mini-toggle ${duration === '120' ? 'is-active' : ''}`} onClick={() => setDuration('120')}>1 - 2 Min</button>
          <button type="button" className={`mini-toggle ${duration === '180' ? 'is-active' : ''}`} onClick={() => setDuration('180')}>~ 3 Min</button>
        </div>
      </div>
    </div>
  );
}

export default ShortsPanel;

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CaptionsPanel({
  captionVideo,
  captionVideoRef,
  captionFile,
  captionRef,
  handleCaptionSelect,
  captionVideoMeta,
  captionFileMeta,
}) {
  return (
    <div className="mode-grid mode-grid-single">
      <div className="file-card">
        <span className="property-label">Video File</span>
        <button type="button" className="file-card-button" onClick={() => captionVideoRef.current?.click()}>
          {captionVideo || captionVideoMeta ? 'Replace Video' : 'Import Video'}
        </button>
        <div className="file-card-name">{captionVideo ? captionVideo.name : captionVideoMeta?.name || 'No file selected'}</div>
        {captionVideoMeta && !captionVideo ? <small className="file-card-meta">{`Previous: ${formatFileSize(captionVideoMeta.size)}`}</small> : null}
        <input type="file" accept="video/*" ref={captionVideoRef} onChange={(event) => handleCaptionSelect(event, true)} className="sr-only-input" />
      </div>

      <div className="file-card">
        <span className="property-label">Subtitle File</span>
        <button type="button" className="file-card-button" onClick={() => captionRef.current?.click()}>
          {captionFile || captionFileMeta ? 'Replace Subtitle' : 'Import Subtitle'}
        </button>
        <div className="file-card-name">{captionFile ? captionFile.name : captionFileMeta?.name || 'No file selected'}</div>
        {captionFileMeta && !captionFile ? <small className="file-card-meta">{`Previous: ${formatFileSize(captionFileMeta.size)}`}</small> : null}
        <input type="file" accept=".srt,.vtt" ref={captionRef} onChange={(event) => handleCaptionSelect(event, false)} className="sr-only-input" />
      </div>
    </div>
  );
}

export default CaptionsPanel;

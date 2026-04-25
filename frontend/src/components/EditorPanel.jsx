function EditorPanel({
  bannerVisible,
  onDismissBanner,
  timeline,
  activeClipIndex,
  onImportClick,
  onUpload,
  fileInputRef,
  videoRef,
  currentClip,
}) {
  return (
    <div className="editor-preview-shell">
      {bannerVisible && (
        <div className="editor-banner">
          <span>This editor is a preview. Export and cloud save are not yet available.</span>
          <button type="button" className="timeline-action-button" onClick={onDismissBanner}>Dismiss</button>
        </div>
      )}

      <div className="editor-preview-header">
        <div>
          <p className="property-label">Media Bin</p>
          <strong>{timeline.length ? `${timeline.length} clip${timeline.length > 1 ? 's' : ''}` : 'No media loaded'}</strong>
        </div>
        <button type="button" className="timeline-action-button timeline-action-accent" onClick={onImportClick}>Import Media</button>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={onUpload} className="sr-only-input" />
      </div>

      <div className="editor-preview-stage">
        {timeline.length ? (
          <video ref={videoRef} className="preview-video" src={currentClip?.url || timeline[activeClipIndex]?.url} />
        ) : (
          <div className="preview-dropzone">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v10M8 8l4-4 4 4M5 15.5V18h14v-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p>Drop video here or click to upload</p>
            <button type="button" className="timeline-action-button timeline-action-accent" onClick={onImportClick}>Choose Video</button>
          </div>
        )}
      </div>

      <div className="editor-preview-clips">
        {timeline.map((clip, index) => (
          <div key={clip.id} className={`editor-clip-chip ${index === activeClipIndex ? 'is-active' : ''}`}>
            <span>{clip.file?.name || `Clip ${index + 1}`}</span>
            <small>{`${(clip.trimmedEnd - clip.trimmedStart).toFixed(2)}s`}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export default EditorPanel;

import React from 'react';

function CaptionsPanel({
  captionVideo,
  captionVideoRef,
  captionFile,
  captionRef,
  handleCaptionSelect,
  captionVideoMeta,
  captionFileMeta
}) {
  
  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="panel-grid single-focus">
      <div className="file-input-group video-group">
        <label>Video File</label>
        <div className="custom-file-upload">
          <button type="button" className="choose-file-btn" onClick={() => captionVideoRef.current.click()}>
            {captionVideo || captionVideoMeta ? 'Replace Video' : 'Import Video'}
          </button>
          {(captionVideo || captionVideoMeta) && <span className="file-name">{captionVideo ? captionVideo.name : captionVideoMeta?.name}</span>}
        </div>
        {captionVideoMeta && !captionVideo && (
          <div className="file-meta-info">
            <small>Previous: {formatFileSize(captionVideoMeta.size)}</small>
          </div>
        )}
        <input type="file" accept="video/*" ref={captionVideoRef} onChange={(e) => handleCaptionSelect(e, true)} style={{ display: 'none' }} />
      </div>

      <div className="file-input-group subtitle-group" style={{marginTop: '1.5rem'}}>
        <label>Subtitle File (.srt or .vtt)</label>
        <div className="custom-file-upload">
          <button type="button" className="choose-file-btn" onClick={() => captionRef.current.click()}>
            {captionFile || captionFileMeta ? 'Replace Subtitle' : 'Import Subtitle'}
          </button>
          {(captionFile || captionFileMeta) && <span className="file-name">{captionFile ? captionFile.name : captionFileMeta?.name}</span>}
        </div>
        {captionFileMeta && !captionFile && (
          <div className="file-meta-info">
            <small>Previous: {formatFileSize(captionFileMeta.size)}</small>
          </div>
        )}
        <input type="file" accept=".srt,.vtt" ref={captionRef} onChange={(e) => handleCaptionSelect(e, false)} style={{ display: 'none' }} />
      </div>

      <div className="info-box" style={{marginTop: '1.5rem'}}>
        <p> NexEditor will burn your subtitle file directly into the video. Make sure your subtitle file is properly formatted.</p>
      </div>
    </div>
  );
}

export default CaptionsPanel;

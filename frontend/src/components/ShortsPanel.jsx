import React from 'react';

function ShortsPanel({
  shortsVideo, shortsVideoRef, handleVideoSelect, setShortsVideo,
  shortsVideoMeta, setShortsVideoMeta,
  duration, setDuration,
  format, setFormat
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
        <label>Long-Form Source Video</label>
        <div className="custom-file-upload">
          <button type="button" className="choose-file-btn" onClick={() => shortsVideoRef.current.click()}>
            {shortsVideo || shortsVideoMeta ? 'Replace Video' : 'Import Video'}
          </button>
          {(shortsVideo || shortsVideoMeta) && <span className="file-name">{shortsVideo ? shortsVideo.name : shortsVideoMeta?.name}</span>}
        </div>
        {shortsVideoMeta && !shortsVideo && (
          <div className="file-meta-info">
            <small>Previous: {formatFileSize(shortsVideoMeta.size)}</small>
          </div>
        )}
        <input type="file" accept="video/*" ref={shortsVideoRef} onChange={(e) => handleVideoSelect(e, setShortsVideo, setShortsVideoMeta, 'Source Video')} style={{ display: 'none' }} />
      </div>

      <div className="file-input-group format-group" style={{marginTop: '1.5rem'}}>
        <label>Platform Orientation</label>
        <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem' }}>
          <button 
            type="button" 
            onClick={() => setFormat('9:16')} 
            className={`selection-btn ${format === '9:16' ? 'active-selection' : ''}`}
          >
             📱 TikTok / Reels (9:16)
          </button>
          <button 
            type="button" 
            onClick={() => setFormat('16:9')} 
            className={`selection-btn ${format === '16:9' ? 'active-selection' : ''}`}
          >
             🖥️ YouTube (16:9)
          </button>
        </div>
      </div>

      <div className="file-input-group format-group" style={{marginTop: '1.5rem'}}>
        <label>Target Duration (Per Clip)</label>
        <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem' }}>
          <button 
            type="button" 
            onClick={() => setDuration('60')} 
            className={`selection-btn ${duration === '60' ? 'active-selection' : ''}`}
          >
             &lt; 1 Min
          </button>
          <button 
            type="button" 
            onClick={() => setDuration('120')} 
            className={`selection-btn ${duration === '120' ? 'active-selection' : ''}`}
          >
             1-2 Mins
          </button>
          <button 
            type="button" 
            onClick={() => setDuration('180')} 
            className={`selection-btn ${duration === '180' ? 'active-selection' : ''}`}
          >
             ~3 Mins
          </button>
        </div>
      </div>

      <div className="info-box" style={{marginTop: '1.5rem'}}>
        <p>NexEditor will automatically extract 3 format-ready clips dynamically shaped for your chosen platform.</p>
      </div>

      <style>{`
        .selection-btn {
          flex: 1;
          padding: 0.8rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #a1a1aa;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-weight: 500;
        }
        .selection-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.3);
        }
        .active-selection {
          background: rgba(129, 140, 248, 0.15) !important;
          border-color: #818cf8 !important;
          color: #fff !important;
          box-shadow: 0 0 10px rgba(129, 140, 248, 0.2);
        }
      `}</style>
    </div>
  );
}

export default ShortsPanel;

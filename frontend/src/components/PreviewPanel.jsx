import React, { useState } from 'react';

function PreviewPanel({ processing, handleConvert, resultUrl, shortsResults, handleReset, handleReformat, handleShortDownload }) {
  const [reformattingId, setReformattingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const executeReformat = async (clip) => {
      setReformattingId(clip.id);
      const newFormat = clip.formatStrategy === 'crop' ? 'letterbox' : 'crop';
      await handleReformat(clip, newFormat);
      setReformattingId(null);
  };

  const executeDownload = async (clip, index) => {
      setDownloadingId(clip.id);
      await handleShortDownload(clip, index);
      setDownloadingId(null);
  };

  return (
    <aside className="preview-sidebar">
      <div className="preview-header">
         <h2>Export</h2>
      </div>
      
      <div className="preview-content">
        <form onSubmit={handleConvert} className="export-form">
          <button type="submit" disabled={processing || reformattingId} className={`submit-btn ${(processing || reformattingId) ? 'processing' : ''}`}>
            {processing ? 'Processing Export...' : 'Export Video'}
            {(processing || reformattingId) && <div className="spinner"></div>}
          </button>
        </form>

        {shortsResults && shortsResults.length > 0 ? (
          <div className="shorts-gallery">
             <h3 className="success-text" style={{marginBottom: '1rem'}}>Shorts Pack Ready 🎉</h3>
             {shortsResults.map((clip, index) => (
                <div key={clip.id} className="short-clip-card" style={{ background: 'rgba(0,0,0,0.4)', padding: '1rem', borderRadius: '12px', marginBottom: '1rem' }}>
                   <h4 style={{margin: '0 0 0.5rem 0', color: '#818cf8'}}>Clip {index + 1}</h4>
                   <video controls src={clip.url} className="result-video" style={{marginBottom: '0.8rem'}}></video>
                   <div className="clip-actions" style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                       <button
                          type="button"
                          onClick={() => executeDownload(clip, index)}
                          disabled={downloadingId === clip.id}
                          className="download-btn"
                          style={{padding: '0.6rem'}}
                        >
                           {downloadingId === clip.id ? 'Downloading...' : 'Download Clip'}
                       </button>
                       <button 
                          type="button"
                          onClick={() => executeReformat(clip)} 
                          disabled={reformattingId === clip.id || downloadingId === clip.id}
                          className="reset-btn" 
                          style={{padding: '0.6rem', fontSize: '0.9rem'}}
                        >
                           {reformattingId === clip.id ? 'Reformatting...' : `Change to ${clip.formatStrategy === 'crop' ? 'Letterbox' : 'Center Crop'}`}
                       </button>
                   </div>
                </div>
             ))}
             <button onClick={handleReset} className="reset-btn" style={{marginTop: '1rem', width: '100%'}}>Start Over</button>
          </div>
        ) : resultUrl ? (
          <div className="result-display">
            <h3 className="success-text">Ready 🎉</h3>
            <video controls src={resultUrl} className="result-video" autoPlay></video>
            <div className="action-buttons-vertical">
              <a href={resultUrl} download="NexEditor_Export.mp4" className="download-btn">Download</a>
              <button onClick={handleReset} className="reset-btn">Start Over</button>
            </div>
          </div>
        ) : (
          <div className="preview-placeholder">
            <div className="placeholder-box">
               <p>Your generated video will appear here.</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export default PreviewPanel;

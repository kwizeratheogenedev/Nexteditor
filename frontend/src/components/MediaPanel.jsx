import React from 'react';

function MediaPanel({
  video1, video1Ref, setVideo1,
  video2, video2Ref, setVideo2,
  video3, video3Ref, setVideo3,
  handleVideoSelect,
  audio, audioRef, handleAudioSelect,
  // Metadata for persistence
  video1Meta, setVideo1Meta,
  video2Meta, setVideo2Meta,
  video3Meta, setVideo3Meta,
  audioMeta
}) {
  
  // Helper to format file size
  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="panel-grid">
      <div className="file-input-group video-group">
        <label>Video Track 1</label>
        <div className="custom-file-upload">
          <button type="button" className="choose-file-btn" onClick={() => video1Ref.current.click()}>
            {video1 || video1Meta ? 'Replace Video' : 'Import Video'}
          </button>
          {(video1 || video1Meta) && <span className="file-name">{video1 ? video1.name : video1Meta?.name}</span>}
        </div>
        {video1Meta && !video1 && (
          <div className="file-meta-info">
            <small>Previous: {formatFileSize(video1Meta.size)}</small>
          </div>
        )}
        <input type="file" accept="video/*" ref={video1Ref} onChange={(e) => handleVideoSelect(e, setVideo1, setVideo1Meta, 'Video 1')} style={{ display: 'none' }} />
      </div>

      <div className="file-input-group video-group">
        <label>Video Track 2</label>
        <div className="custom-file-upload">
          <button type="button" className="choose-file-btn" onClick={() => video2Ref.current.click()}>
            {video2 || video2Meta ? 'Replace Video' : 'Import Video'}
          </button>
          {(video2 || video2Meta) && <span className="file-name">{video2 ? video2.name : video2Meta?.name}</span>}
        </div>
        {video2Meta && !video2 && (
          <div className="file-meta-info">
            <small>Previous: {formatFileSize(video2Meta.size)}</small>
          </div>
        )}
        <input type="file" accept="video/*" ref={video2Ref} onChange={(e) => handleVideoSelect(e, setVideo2, setVideo2Meta, 'Video 2')} style={{ display: 'none' }} />
      </div>

      <div className="file-input-group video-group">
        <label>Video Track 3</label>
        <div className="custom-file-upload">
          <button type="button" className="choose-file-btn" onClick={() => video3Ref.current.click()}>
            {video3 || video3Meta ? 'Replace Video' : 'Import Video'}
          </button>
          {(video3 || video3Meta) && <span className="file-name">{video3 ? video3.name : video3Meta?.name}</span>}
        </div>
        {video3Meta && !video3 && (
          <div className="file-meta-info">
            <small>Previous: {formatFileSize(video3Meta.size)}</small>
          </div>
        )}
        <input type="file" accept="video/*" ref={video3Ref} onChange={(e) => handleVideoSelect(e, setVideo3, setVideo3Meta, 'Video 3')} style={{ display: 'none' }} />
      </div>

      <div className="file-input-group audio-group" style={{marginTop: '1.5rem', gridColumn: '1 / -1'}}>
        <label>Soundtrack</label>
        <div className="custom-file-upload">
          <button type="button" className="choose-file-btn" onClick={() => audioRef.current.click()}>
            {audio || audioMeta ? 'Replace Audio' : 'Import Audio'}
          </button>
          {(audio || audioMeta) && <span className="file-name">{audio ? audio.name : audioMeta?.name}</span>}
        </div>
        {audioMeta && !audio && (
          <div className="file-meta-info">
            <small>Previous: {formatFileSize(audioMeta.size)}</small>
          </div>
        )}
        <input type="file" accept="audio/*" ref={audioRef} onChange={handleAudioSelect} style={{ display: 'none' }} />
      </div>
    </div>
  );
}

export default MediaPanel;

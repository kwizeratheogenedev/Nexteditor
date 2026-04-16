import React from 'react';

function AudioPanel({ audio, audioRef, handleAudioSelect }) {
  return (
    <div className="panel-grid single-focus">
      <div className="file-input-group audio-group">
        <label>Soundtrack</label>
        <div className="custom-file-upload">
          <button type="button" className="choose-file-btn" onClick={() => audioRef.current.click()}>
            {audio ? 'Replace Audio' : 'Import Audio'}
          </button>
          {audio && <span className="file-name">{audio.name}</span>}
        </div>
        <input type="file" accept="audio/*" ref={audioRef} onChange={handleAudioSelect} style={{ display: 'none' }} />
      </div>
    </div>
  );
}

export default AudioPanel;

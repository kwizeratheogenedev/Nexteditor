import React from 'react';
import MediaPanel from './MediaPanel';
import CaptionsPanel from './CaptionsPanel';
import ShortsPanel from './ShortsPanel';
import EditorPanel from './EditorPanel';

function Workspace({
  activeTab,
  mediaProps,
  captionsProps,
  shortsProps
}) {
  return (
    <main className="workspace">
      <header className="workspace-header">
        <h1>{
          activeTab === 'media' ? 'Montage Maker' : 
          activeTab === 'captions' ? 'Subtitle Burner' : 
          activeTab === 'shorts' ? 'Shorts Creator' : 'Advanced Editor'
        }</h1>
        <p className="workspace-subtitle">
          {activeTab === 'media' && "Blend 3 video clips randomly to fit your soundtrack."}
          {activeTab === 'captions' && "Burn a standard subtitle file onto a single video."}
          {activeTab === 'shorts' && "Automatically extract formatted clips for TikTok and Reels."}
          {activeTab === 'editor' && "Professional NLE Video Editor Timeline."}
        </p>
      </header>

      <div className="workspace-content" style={activeTab === 'editor' ? {height: '100%'} : {}}>
        {activeTab === 'media' && <MediaPanel {...mediaProps} />}
        {activeTab === 'captions' && <CaptionsPanel {...captionsProps} />}
        {activeTab === 'shorts' && <ShortsPanel {...shortsProps} />}
        {activeTab === 'editor' && <EditorPanel />}
      </div>
    </main>
  );
}

export default Workspace;

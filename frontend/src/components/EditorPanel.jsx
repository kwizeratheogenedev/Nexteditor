import './EditorWorkspace.css';

const EditorIcon = ({ children }) => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;

function EditorPanel({ bannerVisible, onDismissBanner, timeline, activeClipIndex, onSelectClip, onImportClick, onUpload, fileInputRef, videoRef, currentClip }) {
  return (
    <div className="capcut-editor-workspace">
      {bannerVisible && <div className="editor-notice"><span><b>Local project</b> Changes stay in this browser session.</span><button type="button" onClick={onDismissBanner}>×</button></div>}

      <aside className="editor-media-library">
        <div className="editor-library-tabs"><button type="button" className="is-active">Media</button><button type="button">Library</button></div>
        <div className="editor-library-toolbar"><strong>Local</strong><button type="button" onClick={onImportClick}>+ Import</button></div>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={onUpload} className="sr-only-input" />

        {timeline.length ? <div className="editor-media-grid">{timeline.map((clip, index) => <button type="button" key={clip.id} className={index === activeClipIndex ? 'is-active' : ''} onClick={() => onSelectClip?.(index)}><div className="editor-media-thumb"><video src={clip.url} muted preload="metadata"/><span>{Math.max(0, clip.trimmedEnd - clip.trimmedStart).toFixed(1)}s</span></div><strong>{clip.file?.name || `Clip ${index + 1}`}</strong><small>Video · Added</small></button>)}</div> : <button type="button" className="editor-library-empty" onClick={onImportClick}><span><EditorIcon><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M5 15v4h14v-4"/></EditorIcon></span><strong>Import media</strong><small>Video files from your device</small></button>}
      </aside>

      <section className="editor-canvas-area">
        <header className="editor-canvas-toolbar"><div><button type="button" className="is-active">Player</button><button type="button">Preview</button></div><div><span>Fit</span><button type="button">100%</button><button type="button" title="Canvas settings">•••</button></div></header>
        <div className="editor-player-stage">
          {timeline.length ? <div className="editor-player-frame"><video ref={videoRef} src={currentClip?.url || timeline[activeClipIndex]?.url} /><span className="editor-transform-corner top-left"/><span className="editor-transform-corner top-right"/><span className="editor-transform-corner bottom-left"/><span className="editor-transform-corner bottom-right"/></div> : <div className="editor-canvas-empty"><span><EditorIcon><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></EditorIcon></span><h2>Start creating</h2><p>Import a video to add it to your timeline.</p><button type="button" onClick={onImportClick}>Import media</button></div>}
        </div>
        <footer className="editor-canvas-footer"><span>Preview quality</span><b>1080p</b><i/><span>Canvas</span><b>16:9</b></footer>
      </section>
    </div>
  );
}

export default EditorPanel;

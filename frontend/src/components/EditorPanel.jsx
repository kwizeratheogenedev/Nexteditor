import { useState, useEffect } from 'react';
import './EditorWorkspace.css';

const EditorIcon = ({ children }) => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;

function EditorPanel({ bannerVisible, onDismissBanner, timeline, activeClipIndex, onSelectClip, onImportClick, onUpload, fileInputRef, videoRef, currentClip }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime || 0);
    const handleLoadedMetadata = () => setDuration(video.duration || 0);
    const handleEnded = () => setPlaying(false);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoRef]);

  const toggle = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  const handleSeek = (e) => {
    if (!videoRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    videoRef.current.currentTime = pct * duration;
  };

  const pct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="capcut-editor-workspace">
      {bannerVisible && <div className="editor-notice"><span><b>Local project</b> Changes stay in this browser session.</span><button type="button" onClick={onDismissBanner}>×</button></div>}

      <aside className="editor-media-library">
        <div className="editor-library-tabs"><button type="button" className="is-active">Media</button><button type="button">Library</button></div>
        <div className="editor-library-toolbar"><strong>Local</strong><button type="button" onClick={onImportClick}>+ Import</button></div>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={onUpload} className="sr-only-input" />

        {timeline.length ? <div className="editor-media-grid">{timeline.map((clip, index) => <button type="button" key={clip.id} className={index === activeClipIndex ? 'is-active' : ''} onClick={() => onSelectClip?.(index)}><div className="editor-media-thumb"><video src={clip.url} muted preload="metadata"/><span>{(clip.trimmedEnd - clip.trimmedStart).toFixed(1)}s</span></div><strong>{clip.file?.name || `Clip ${index + 1}`}</strong><small>Video · Added</small></button>)}</div> : <button type="button" className="editor-library-empty" onClick={onImportClick}><span><EditorIcon><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M5 15v4h14v-4"/></EditorIcon></span><strong>Import media</strong><small>Video files from your device</small></button>}
      </aside>

      <section className="editor-canvas-area">
        <header className="editor-canvas-toolbar"><div><button type="button" className="is-active">Player</button><button type="button">Preview</button></div><div><span>Fit</span><button type="button">100%</button><button type="button" title="Canvas settings">•••</button></div></header>
        <div className="editor-player-stage">
          {timeline.length ? <div className="editor-player-frame"><video ref={videoRef} src={currentClip?.url || timeline[activeClipIndex]?.url} style={{ width:'100%', height:'100%', objectFit:'contain' }} onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)} onEnded={() => setPlaying(false)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} /><span className="editor-transform-corner top-left"/><span className="editor-transform-corner top-right"/><span className="editor-transform-corner bottom-left"/><span className="editor-transform-corner bottom-right"/></div> : <div className="editor-canvas-empty"><span><EditorIcon><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></EditorIcon></span><h2>Start creating</h2><p>Import a video to add it to your timeline.</p><button type="button" onClick={onImportClick}>Import media</button></div>}
        </div>
        <footer className="editor-canvas-footer"><span>Preview quality</span><b>1080p</b><i/><span>Canvas</span><b>16:9</b></footer>
      </section>

      {timeline.length > 0 && (
        <div style={{ position:'absolute', bottom: 8, left: '50%', transform:'translateX(-50%)', display:'flex', alignItems:'center', gap:10, padding:'6px 12px', background:'rgba(0,0,0,.7)', borderRadius:10, backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,.08)' }}>
          <button onClick={toggle} style={{ width:32, height:32, borderRadius:8, background:'#7c3aed', border:'none', color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ width:14, height:14 }}>{playing ? <EditorIcon><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></EditorIcon> : <EditorIcon><polygon points="6,3 18,12 6,21"/></EditorIcon>}</div>
          </button>
          <div style={{ width:120, height:3, background:'rgba(255,255,255,.15)', borderRadius:99, cursor:'pointer', position:'relative' }} onClick={handleSeek}>
            <div style={{ position:'absolute', left:0, top:0, bottom:0, background:'#7c3aed', width:`${pct}%`, borderRadius:99 }} />
            <div style={{ position:'absolute', left:`${pct}%`, top:'50%', width:8, height:8, borderRadius:'50%', background:'#fff', transform:'translate(-50%,-50%)', boxShadow:'0 0 4px rgba(0,0,0,.4)' }} />
          </div>
          <span style={{ fontSize:10, color:'rgba(255,255,255,.7)', minWidth:64, textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{(currentTime || 0).toFixed(1)}s / {(duration || 0).toFixed(1)}s</span>
        </div>
      )}
    </div>
  );
}

export default EditorPanel;

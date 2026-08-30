import { useMemo, useRef, useState } from 'react';
import './EditorWorkspace.css';
import CanvasSettingsMenu from './CanvasSettingsMenu';

const EditorIcon = ({ children }) => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;

function formatSeconds(value) {
  return (Number.isFinite(value) ? value : 0).toFixed(1);
}

// Maps a client (mouse) position to canvas-internal pixel coordinates,
// accounting for the canvas's own resolution (the project's canvasSize,
// which can be any aspect ratio/resolution since schema v4 - see
// usePersistedEditorState.js) being displayed at a different, letterboxed
// CSS size via object-fit:contain. Reads canvasEl.width/height live, so it
// already works for any canvas size without needing the size passed in.
function getCanvasContentRect(canvasEl) {
  const rect = canvasEl.getBoundingClientRect();
  const canvasAspect = canvasEl.width / canvasEl.height;
  const boxAspect = rect.width / rect.height;
  let width;
  let height;
  if (boxAspect > canvasAspect) {
    height = rect.height;
    width = rect.height * canvasAspect;
  } else {
    width = rect.width;
    height = rect.width / canvasAspect;
  }
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

function EditorPanel({
  bannerVisible, onDismissBanner, timeline, selectedClipId, selectedClip, onSelectClip, onImportClick, onUpload, fileInputRef,
  canvasRef, isPlaying, currentTime, videoDuration, onTogglePlayback, onSeek, onMoveOverlay, onMoveOverlayEnd,
  canvasSize, onCanvasSizeChange,
}) {
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false);
  // One card per unique imported SOURCE, not one per timeline clip - the
  // timeline can reference the same source many times (split, duplicate,
  // freeze-frame all add clip entries without importing anything new), so
  // filtering timeline directly used to make split/duplicate look like a
  // fresh import: a second card for the same file would appear immediately.
  // Dedup key falls back to clip.id only for a legacy clip somehow missing
  // sourceId, so it still renders instead of silently vanishing.
  const mediaClips = useMemo(() => {
    const bySource = new Map();
    timeline.forEach((clip) => {
      if (clip.type !== 'video' && clip.type) return;
      const key = clip.sourceId || clip.id;
      if (!bySource.has(key)) bySource.set(key, clip);
    });
    return [...bySource.values()];
  }, [timeline]);
  const hasContent = timeline.length > 0;
  const pct = videoDuration ? (currentTime / videoDuration) * 100 : 0;
  const overlayDragRef = useRef(null);

  // Only a clip on an overlay lane (trackIndex 1+) is directly draggable on
  // the canvas - lane 0 fills the whole frame, so moving it around wouldn't
  // mean anything. Reposition-by-dragging is the CapCut-familiar way to
  // place picture-in-picture content; this writes straight to the same
  // transform.x/y RightPanel's Position sliders already use, so both stay
  // in sync automatically.
  const isOverlayClip = selectedClip && (selectedClip.type === 'video' || !selectedClip.type) && (selectedClip.trackIndex || 0) > 0;

  const handleSeek = (event) => {
    if (!videoDuration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min((event.clientX - rect.left) / rect.width, 1));
    onSeek?.(pct * videoDuration);
  };

  const handleOverlayDragStart = (event) => {
    if (!isOverlayClip || !canvasRef.current) return;
    event.preventDefault();
    const content = getCanvasContentRect(canvasRef.current);
    overlayDragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      // transform.x/y are a percent of half the canvas dimension (schema
      // v4+) - converting the on-screen CSS-pixel drag delta straight to a
      // percent delta only needs the content box's own on-screen size, not
      // the canvas's actual pixel dimensions (the canvas-pixel scale factor
      // cancels out of the ratio algebraically).
      contentWidth: content.width,
      contentHeight: content.height,
      originX: selectedClip.transform?.x || 0,
      originY: selectedClip.transform?.y || 0,
    };
    window.addEventListener('mousemove', handleOverlayDragMove);
    window.addEventListener('mouseup', handleOverlayDragEnd);
  };

  const handleOverlayDragMove = (event) => {
    const drag = overlayDragRef.current;
    if (!drag) return;
    const deltaPercentX = ((event.clientX - drag.startClientX) * 200) / drag.contentWidth;
    const deltaPercentY = ((event.clientY - drag.startClientY) * 200) / drag.contentHeight;
    onMoveOverlay?.(selectedClipId, drag.originX + deltaPercentX, drag.originY + deltaPercentY);
  };

  const handleOverlayDragEnd = () => {
    overlayDragRef.current = null;
    window.removeEventListener('mousemove', handleOverlayDragMove);
    window.removeEventListener('mouseup', handleOverlayDragEnd);
    onMoveOverlayEnd?.();
  };

  return (
    <div className="capcut-editor-workspace">
      {bannerVisible && <div className="editor-notice"><span><b>Local project</b> Changes stay in this browser session.</span><button type="button" onClick={onDismissBanner}>×</button></div>}

      <aside className="editor-media-library">
        <div className="editor-library-tabs"><button type="button" className="is-active">Media</button><button type="button">Library</button></div>
        <div className="editor-library-toolbar"><strong>Local</strong><button type="button" onClick={onImportClick}>+ Import</button></div>
        <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={onUpload} className="sr-only-input" />

        {mediaClips.length ? <div className="editor-media-grid">{mediaClips.map((clip, index) => <button type="button" key={clip.id} className={selectedClipId === clip.id ? 'is-active' : ''} onClick={() => onSelectClip?.(clip.id)}><div className="editor-media-thumb"><video src={clip.url} muted preload="metadata"/><span>{(clip.trimmedEnd - clip.trimmedStart).toFixed(1)}s</span></div><strong>{clip.file?.name || `Clip ${index + 1}`}</strong><small>Video · Added</small></button>)}</div> : <button type="button" className="editor-library-empty" onClick={onImportClick}><span><EditorIcon><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M5 15v4h14v-4"/></EditorIcon></span><strong>Import media</strong><small>Video or audio files from your device</small></button>}
      </aside>

      <section className="editor-canvas-area">
        <header className="editor-canvas-toolbar" style={{ position: 'relative' }}><div><button type="button" className="is-active">Player</button><button type="button">Preview</button></div><div><span>Fit</span><button type="button">100%</button><button type="button" title="Canvas settings" onClick={() => setCanvasSettingsOpen((v) => !v)}>•••</button>{canvasSettingsOpen && <CanvasSettingsMenu canvasSize={canvasSize} onChange={onCanvasSizeChange} onClose={() => setCanvasSettingsOpen(false)} />}</div></header>
        <div className="editor-player-stage">
          {hasContent ? <div className="editor-player-frame"><canvas ref={canvasRef} onMouseDown={handleOverlayDragStart} style={{ width:'100%', height:'100%', objectFit:'contain', cursor: isOverlayClip ? 'move' : 'default' }} /><span className="editor-transform-corner top-left"/><span className="editor-transform-corner top-right"/><span className="editor-transform-corner bottom-left"/><span className="editor-transform-corner bottom-right"/></div> : <div className="editor-canvas-empty"><span><EditorIcon><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></EditorIcon></span><h2>Start creating</h2><p>Import a video to add it to your timeline.</p><button type="button" onClick={onImportClick}>Import media</button></div>}
        </div>
        <footer className="editor-canvas-footer"><span>Preview quality</span><b>{canvasSize?.resolutionId ? canvasSize.resolutionId : `${canvasSize?.height || 1080}p`}</b><i/><span>Canvas</span><b>{canvasSize?.aspectRatioId || '16:9'}</b></footer>
      </section>

      {mediaClips.length > 0 && (
        <div style={{ position:'absolute', bottom: 8, left: '50%', transform:'translateX(-50%)', display:'flex', alignItems:'center', gap:10, padding:'6px 12px', background:'rgba(0,0,0,.7)', borderRadius:10, backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,.08)' }}>
          <button onClick={onTogglePlayback} style={{ width:32, height:32, borderRadius:8, background:'#7c3aed', border:'none', color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ width:14, height:14 }}>{isPlaying ? <EditorIcon><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></EditorIcon> : <EditorIcon><polygon points="6,3 18,12 6,21"/></EditorIcon>}</div>
          </button>
          <div style={{ width:120, height:3, background:'rgba(255,255,255,.15)', borderRadius:99, cursor:'pointer', position:'relative' }} onClick={handleSeek}>
            <div style={{ position:'absolute', left:0, top:0, bottom:0, background:'#7c3aed', width:`${pct}%`, borderRadius:99 }} />
            <div style={{ position:'absolute', left:`${pct}%`, top:'50%', width:8, height:8, borderRadius:'50%', background:'#fff', transform:'translate(-50%,-50%)', boxShadow:'0 0 4px rgba(0,0,0,.4)' }} />
          </div>
          <span style={{ fontSize:10, color:'rgba(255,255,255,.7)', minWidth:64, textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{formatSeconds(currentTime)}s / {formatSeconds(videoDuration)}s</span>
        </div>
      )}
    </div>
  );
}

export default EditorPanel;

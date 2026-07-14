function TrackIcon({ type }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true">{type === 'audio' ? <path d="M10 2v8.2a2.2 2.2 0 1 1-1-1.8V4l4-1v5.5a2.2 2.2 0 1 1-1-1.8V2.5Z" fill="currentColor"/> : type === 'text' ? <path d="M3 3h10v2H9v8H7V5H3Z" fill="currentColor"/> : <path d="M2 3h9a2 2 0 0 1 2 2v1l2-1v6l-2-1v1a2 2 0 0 1-2 2H2Z" fill="currentColor"/>}</svg>;
}

function TrackLabel({ type, label }) {
  return <div className="timeline-track-label"><TrackIcon type={type}/><span>{label}</span><div className="track-mini-actions"><button type="button" title="Toggle track">◉</button><button type="button" title="Lock track">⌑</button></div></div>;
}

function ClipBlock({ clip }) {
  const width = Math.max(86, clip.duration * 22);
  return <div className={`timeline-clip timeline-clip-${clip.type}`} style={{ width: `${width}px` }} title={clip.label}><span className="timeline-clip-leading"/>{clip.type === 'audio' && <span className="timeline-waveform">▂▅▃▆▄▇▃▅</span>}<strong>{clip.label}</strong><small>{clip.duration.toFixed(1)}s</small></div>;
}

function TrackRow({ clips, placeholder }) {
  return <div className="timeline-track-row">{clips.length ? clips.map((clip) => <ClipBlock key={clip.id} clip={clip}/>) : <div className="timeline-placeholder">{placeholder}</div>}</div>;
}

function BottomTimeline({ activeTab, tracks, currentTime, totalDuration, zoom, onZoomChange, onSeek, onSplit, onDelete }) {
  const duration = Math.max(totalDuration || 0, 32);
  const playheadLeft = `${Math.max(0, Math.min((currentTime / duration) * 100, 100))}%`;
  return <section className="bottom-timeline capcut-timeline">
    <div className="timeline-toolbar"><div className="timeline-tool-group"><button type="button" className="timeline-action-button" onClick={onSplit}>Split</button><button type="button" className="timeline-action-button" onClick={onDelete}>Delete</button><span/><button type="button" className="timeline-action-button">Undo</button><button type="button" className="timeline-action-button">Redo</button></div><div className="timeline-toolbar-spacer"/><span className="timeline-snapping">Magnet on</span><button type="button" className="timeline-action-button" onClick={() => onZoomChange(Math.max(50, zoom - 10))}>−</button><input aria-label="Timeline zoom" type="range" min="50" max="200" value={zoom} onChange={(event) => onZoomChange(Number(event.target.value))}/><button type="button" className="timeline-action-button" onClick={() => onZoomChange(Math.min(200, zoom + 10))}>+</button></div>
    <div className="timeline-ruler"><div className="timeline-ruler-offset"><span>{tracks.video.length + tracks.audio.length + tracks.text.length} tracks</span></div><div className="timeline-ruler-markers">{[0,4,8,12,16,20,24,28,32].map((marker)=><span key={marker}>{`00:${String(marker).padStart(2,'0')}`}</span>)}</div></div>
    <div className="timeline-tracks"><div className="timeline-track-labels"><TrackLabel type="text" label="Text"/><TrackLabel type="video" label="Video 1"/><TrackLabel type="audio" label="Audio 1"/></div><div className="timeline-track-surface" onClick={(event)=>{const rect=event.currentTarget.getBoundingClientRect();onSeek(duration*Math.max(0,Math.min((event.clientX-rect.left)/rect.width,1)));}}><div className="timeline-playhead" style={{left:playheadLeft}}><span className="timeline-playhead-time">{currentTime.toFixed(1)}s</span><span className="timeline-playhead-handle"/></div><TrackRow clips={tracks.text} placeholder="Add text or captions"/><TrackRow clips={tracks.video} placeholder={activeTab==='editor'?'Drag media here':'Drop clips here'}/><TrackRow clips={tracks.audio} placeholder="Add audio"/></div></div>
  </section>;
}

export default BottomTimeline;

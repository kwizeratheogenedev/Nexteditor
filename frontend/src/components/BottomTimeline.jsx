function VideoTrackIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 3.2A1.2 1.2 0 0 1 3.2 2h3.6A1.2 1.2 0 0 1 8 3.2v1.1l2-1v5.4l-2-1v1.1A1.2 1.2 0 0 1 6.8 10H3.2A1.2 1.2 0 0 1 2 8.8Z" fill="currentColor" />
    </svg>
  );
}

function AudioTrackIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M8 2v5.5a1.8 1.8 0 1 1-.7-1.4V3.2l2.7-.7v4.2A1.8 1.8 0 1 1 9.3 5V2Z" fill="currentColor" />
    </svg>
  );
}

function TextTrackIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="2" width="8" height="1.2" rx=".6" fill="currentColor" />
      <rect x="5.4" y="3.2" width="1.2" height="5.6" rx=".6" fill="currentColor" />
      <rect x="3.5" y="8.8" width="5" height="1.2" rx=".6" fill="currentColor" />
    </svg>
  );
}

function TrackLabel({ type, label }) {
  const Icon = type === 'audio' ? AudioTrackIcon : type === 'text' ? TextTrackIcon : VideoTrackIcon;

  return (
    <div className="timeline-track-label">
      <Icon />
      <span>{label}</span>
    </div>
  );
}

function ClipBlock({ clip }) {
  return (
    <div
      className={`timeline-clip timeline-clip-${clip.type}`}
      style={{ width: `${Math.max(72, clip.duration * 18)}px` }}
      title={clip.label}
    >
      {clip.label}
    </div>
  );
}

function TrackRow({ clips, type, placeholder }) {
  return (
    <div className="timeline-track-row">
      {clips.length ? clips.map((clip) => <ClipBlock key={clip.id} clip={clip} />) : <div className="timeline-placeholder">{placeholder}</div>}
    </div>
  );
}

function BottomTimeline({ activeTab, tracks, currentTime, totalDuration, zoom, onZoomChange, onSeek, onSplit, onDelete }) {
  const duration = Math.max(totalDuration || 0, 32);
  const playheadLeft = `${Math.max(0, Math.min((currentTime / duration) * 100, 100))}%`;

  return (
    <section className="bottom-timeline">
      <div className="timeline-toolbar">
        <button type="button" className="timeline-action-button" onClick={onSplit}>✂ Split</button>
        <button type="button" className="timeline-action-button" onClick={onDelete}>⌫ Delete</button>
        <button type="button" className="timeline-action-button timeline-action-accent">+ Add clip</button>
        <button type="button" className="timeline-action-button">↩ Undo</button>
        <button type="button" className="timeline-action-button">↪ Redo</button>
        <div className="timeline-toolbar-spacer" />
        <button type="button" className="timeline-action-button" onClick={() => onZoomChange(Math.max(50, zoom - 10))}>−</button>
        <span className="timeline-zoom-label">{`${zoom}%`}</span>
        <button type="button" className="timeline-action-button" onClick={() => onZoomChange(Math.min(200, zoom + 10))}>+</button>
      </div>

      <div className="timeline-ruler">
        <div className="timeline-ruler-offset" />
        <div className="timeline-ruler-markers">
          {[0, 4, 8, 12, 16, 20, 24, 28, 32].map((marker) => (
            <span key={marker}>{`${marker}s`}</span>
          ))}
        </div>
      </div>

      <div className="timeline-tracks">
        <div className="timeline-track-labels">
          <TrackLabel type="video" label="Video" />
          <TrackLabel type="audio" label="Audio" />
          <TrackLabel type="text" label="Text" />
        </div>

        <div
          className="timeline-track-surface"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const percent = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
            onSeek(duration * Math.max(0, Math.min(percent, 1)));
          }}
        >
          <div className="timeline-playhead" style={{ left: playheadLeft }}>
            <span className="timeline-playhead-handle" />
          </div>
          <TrackRow clips={tracks.video} type="video" placeholder={activeTab === 'editor' ? 'Drop clips here' : 'Drop clips here'} />
          <TrackRow clips={tracks.audio} type="audio" placeholder="Drop clips here" />
          <TrackRow clips={tracks.text} type="text" placeholder="Drop clips here" />
        </div>
      </div>
    </section>
  );
}

export default BottomTimeline;

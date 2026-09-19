import { useEffect, useRef, useState } from 'react';
import { getWaveformForClip, sliceWaveform } from '../timeline/waveform';
import { getThumbnailStripForClip, framesForTrimWindow } from '../timeline/thumbnails';
import TimelineMinimap from './TimelineMinimap';

function HoverScrubPreview({ preview }) {
  if (!preview) return null;
  return (
    <div className="timeline-hover-preview" style={{ left: `${preview.x}px`, top: `${preview.y}px` }}>
      <img src={preview.dataUrl} alt="" />
    </div>
  );
}

// Pixels-per-second at 100% zoom - shared with App.jsx's drag/trim math
// (imported there) so screen deltas and stored time deltas agree.
export const PX_PER_SECOND = 24;

// Auto-switches to H:MM:SS once the value crosses an hour (matches CapCut -
// a short clip's timeline never shows a leading "0:", but a multi-hour
// project doesn't wrap/misread as raw minutes past 60). `decimals` renders
// a fractional-seconds tail (e.g. "0:01.5") for ruler labels at a zoom level
// fine enough that whole-second labels would otherwise repeat.
function formatTime(seconds, decimals = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const secsStr = decimals > 0
    ? secs.toFixed(decimals).padStart(3 + decimals, '0')
    : String(Math.floor(secs)).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(mins).padStart(2, '0')}:${secsStr}` : `${mins}:${secsStr}`;
}

// CapCut-style ruler: the tick interval is chosen purely from the current
// zoom level (pxPerSecond), not from total duration - a 5-second clip and a
// 2-hour timeline use the exact same rule, picking the smallest "nice"
// interval whose ticks land at least MIN_TICK_PX_GAP apart on screen. That
// means zooming in on a short clip reveals sub-second ticks, and zooming
// out on a long project collapses down to minute/hour ticks - the interval
// tracks pixel density, not how long the footage happens to be.
const NICE_TICK_INTERVALS_SECONDS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30,
  60, 2 * 60, 5 * 60, 10 * 60, 15 * 60, 30 * 60,
  3600, 2 * 3600, 5 * 3600, 10 * 3600,
];
const MIN_TICK_PX_GAP = 70;

function getRulerConfig(totalDuration, pxPerSecond) {
  const safe = Math.max(0, Number(totalDuration) || 0);
  let step = NICE_TICK_INTERVALS_SECONDS[NICE_TICK_INTERVALS_SECONDS.length - 1];
  for (const interval of NICE_TICK_INTERVALS_SECONDS) {
    if (interval * pxPerSecond >= MIN_TICK_PX_GAP) {
      step = interval;
      break;
    }
  }
  const markers = [];
  for (let t = 0; t <= safe; t += step) {
    markers.push(t);
  }
  if (markers[markers.length - 1] !== safe && safe > 0) {
    markers.push(safe);
  }
  return { step, markers, max: safe, decimals: step < 1 ? 1 : 0 };
}

function TrackIcon({ type }) {
  if (type === 'audio') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
  }
  if (type === 'text') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>;
}

export const LANE_ROW_HEIGHT = 44;
const LANE_ROW_HEIGHT_EXPANDED = 72;
const ADD_TRACK_ROW_HEIGHT = 28;

// Height of a lane's row, kept identical between the label column and the
// track-surface column so the two side-by-side lists stay aligned. Exported
// so App.jsx's vertical clip-drag math can use the same per-type row height
// (a type's lanes are expanded/collapsed as a group, so one height covers
// every lane of that type) instead of assuming the collapsed 44px always.
export function laneHeight(expanded) {
  return expanded ? LANE_ROW_HEIGHT_EXPANDED : LANE_ROW_HEIGHT;
}

function TrackLabel({
  type, label, expanded, onExpand, onAddClip, locked, hidden, onToggleLock, onToggleHidden,
  onRename, onRemove, canRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  const startEditing = () => {
    if (!onRename) return;
    setDraft(label);
    setEditing(true);
  };
  const commitEditing = () => {
    setEditing(false);
    onRename?.(draft);
  };

  return (
    <div className="timeline-track-label" style={{ height: laneHeight(expanded) }}>
      <button type="button" className="track-expand-btn" onClick={onExpand}>
        <span style={{ display: 'inline-block', transition: 'transform 150ms', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
      </button>
      <span className="timeline-track-icon"><TrackIcon type={type}/></span>
      {editing ? (
        <input
          type="text"
          className="timeline-track-name-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEditing();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="timeline-track-name" title={onRename ? 'Double-click to rename' : undefined} onDoubleClick={startEditing}>{label}</span>
      )}
      <div className="track-mini-actions">
        {onAddClip && <button type="button" className="track-action" title={`Add ${type}`} aria-label={`Add ${type}`} onClick={onAddClip}>+</button>}
        {onMoveUp && <button type="button" className="track-action" title="Move track up" aria-label="Move track up" disabled={!canMoveUp} onClick={onMoveUp}>↑</button>}
        {onMoveDown && <button type="button" className="track-action" title="Move track down" aria-label="Move track down" disabled={!canMoveDown} onClick={onMoveDown}>↓</button>}
        <button type="button" className={`track-action ${hidden ? 'is-active' : ''}`} title={type === 'audio' ? 'Mute track' : 'Hide track'} aria-label={type === 'audio' ? 'Mute track' : 'Hide track'} onClick={onToggleHidden}><span className="track-dot"/></button>
        <button type="button" className={`track-action ${locked ? 'is-active' : ''}`} title="Lock track" aria-label="Lock track" onClick={onToggleLock}><span className="track-lock">⌑</span></button>
        {onRemove && <button type="button" className="track-action" title="Remove track" aria-label="Remove track" disabled={!canRemove} onClick={onRemove}>✕</button>}
      </div>
    </div>
  );
}

// A marker's chip in the compact "list + jump-to" row - click the label to
// seek there, double-click to rename inline (mirrors TrackLabel's rename
// pattern), ✕ to delete.
function MarkerChip({ marker, onJump, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(marker.label || '');

  const startEditing = () => {
    setDraft(marker.label || '');
    setEditing(true);
  };
  const commitEditing = () => {
    setEditing(false);
    onRename?.(marker.id, draft);
  };

  return (
    <div className="timeline-marker-chip">
      {editing ? (
        <input
          type="text"
          className="timeline-marker-chip-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEditing();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="timeline-marker-chip-label" onClick={() => onJump?.(marker.time)} onDoubleClick={startEditing} title="Click to jump to this marker, double-click to rename">
          {marker.label || formatTime(marker.time)}
        </button>
      )}
      <button type="button" className="timeline-marker-chip-remove" onClick={() => onRemove?.(marker.id)} title="Delete marker">✕</button>
    </div>
  );
}

// The marker's tick on the timeline itself, in the same absolute-position
// coordinate system the playhead already uses (inside .timeline-track-surface,
// so it scrolls in sync with clips automatically).
function MarkerTick({ marker, pxPerSecond, onJump, onRemove }) {
  return (
    <div
      className="timeline-marker-tick"
      style={{ left: `${marker.time * pxPerSecond}px` }}
      title={marker.label || formatTime(marker.time)}
      onClick={(e) => { e.stopPropagation(); onJump?.(marker.time); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onRemove?.(marker.id); }}
    >
      <span className="timeline-marker-flag" />
    </div>
  );
}

// Renders the clip's real audio peaks (decoded once per source, see
// timeline/waveform.js) as a bar canvas, re-sliced whenever the clip's trim
// window or rendered width changes. Silently renders nothing if decoding
// fails (e.g. an unreachable remote source) - the clip block itself still
// works fine without a waveform.
function ClipWaveform({ clip, width, height }) {
  const canvasRef = useRef(null);
  const [waveform, setWaveform] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getWaveformForClip(clip).then((result) => {
      if (!cancelled) setWaveform(result);
    });
    return () => { cancelled = true; };
    // sourceId identifies the underlying source file - only a new source
    // needs a fresh decode, not every trim/duplicate of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.sourceId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const dpr = window.devicePixelRatio || 1;
    const bucketCount = Math.max(1, Math.round(width));
    canvas.width = bucketCount * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, bucketCount, height);
    const peaks = sliceWaveform(waveform, clip.trimmedStart || 0, clip.trimmedEnd ?? waveform.duration, bucketCount);
    ctx.fillStyle = 'rgba(34, 197, 94, 0.75)'; // matches --clip-audio green token
    const mid = height / 2;
    for (let i = 0; i < bucketCount; i += 1) {
      const amp = Math.min(1, peaks[i] * 3.2); // peaks are usually well under 1.0 - scale up for visibility
      const barHeight = Math.max(1, amp * mid);
      ctx.fillRect(i, mid - barHeight, 1, barHeight * 2);
    }
  }, [waveform, width, height, clip.trimmedStart, clip.trimmedEnd]);

  return <canvas ref={canvasRef} className="timeline-waveform-canvas" style={{ width: `${width}px`, height: `${height}px` }} />;
}

// Renders evenly-spaced representative frames (decoded once per source, see
// timeline/thumbnails.js) as a filmstrip background behind a video clip's
// label - purely decorative, capped in density so it doesn't render more
// cells than the clip's on-screen width can usefully show.
function ClipFilmstrip({ clip, width, height }) {
  const [strip, setStrip] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getThumbnailStripForClip(clip).then((result) => {
      if (!cancelled) setStrip(result);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.sourceId]);

  if (!strip) return null;
  const trimmedStart = clip.trimmedStart || 0;
  const trimmedEnd = clip.trimmedEnd ?? strip.duration;
  const available = framesForTrimWindow(strip, trimmedStart, trimmedEnd);
  if (!available.length) return null;

  const cellCount = Math.max(1, Math.min(available.length, Math.floor(width / 80)));
  const cellWidth = width / cellCount;
  const cells = Array.from({ length: cellCount }, (_, i) => {
    const targetTime = trimmedStart + ((i + 0.5) / cellCount) * (trimmedEnd - trimmedStart);
    let nearest = available[0];
    let bestDelta = Infinity;
    available.forEach((frame) => {
      const delta = Math.abs(frame.time - targetTime);
      if (delta < bestDelta) {
        bestDelta = delta;
        nearest = frame;
      }
    });
    return nearest;
  });

  return (
    <div className="timeline-clip-filmstrip" style={{ width: `${width}px`, height: `${height}px` }}>
      {cells.map((frame, i) => (
        <div
          key={`${frame.time}-${i}`}
          className="timeline-clip-filmstrip-cell"
          style={{ width: `${cellWidth}px`, backgroundImage: `url(${frame.dataUrl})` }}
        />
      ))}
    </div>
  );
}

// A custom clip.color override (set via RightPanel's "Clip color" swatches)
// replaces the type-based background/border - null falls through to
// whatever the .timeline-clip-{type} CSS class already draws, matching the
// same low-alpha look those classes already use.
function clipColorStyle(hex) {
  if (!hex) return {};
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    background: `rgba(${r}, ${g}, ${b}, 0.22)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.6)`,
  };
}

// A still image's timeline block shows the picture itself, tiled across the
// block's width so a longer clip reads like the filmstrip a video clip
// gets. No decode pass needed (unlike waveforms/filmstrips) - the browser
// already has the bitmap from the same object URL the preview draws.
function ClipStill({ clip, width, height }) {
  const source = clip.url || clip.remoteUrl;
  if (!source) return null;
  const cellWidth = Math.max(60, Math.min(120, width));
  return (
    <div
      className="timeline-clip-filmstrip"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        backgroundImage: `url(${source})`,
        backgroundSize: `${cellWidth}px ${height}px`,
        backgroundRepeat: 'repeat-x',
      }}
    />
  );
}

// True once the element has actually been scrolled into view, and it stays
// true afterward. The waveform/filmstrip/still behind each clip block is
// the expensive part of a timeline row, and a long-mix project can hold a
// hundred-plus clips of which only a handful are on screen - so they're
// only built for blocks the user has actually scrolled to. Deliberately an
// IntersectionObserver rather than deriving visibility from scroll
// position: the timeline's horizontal scrolling is handled by direct DOM
// mutation precisely to avoid a re-render per scroll tick (see
// handleTrackSurfaceScroll), and reading scrollLeft into React state here
// would undo that.
function useInViewport(ref) {
  // Without IntersectionObserver (an old browser, a test environment)
  // everything is simply treated as visible from the start - the strips are
  // an enhancement, never a requirement for the clip block to work.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver !== 'function');
  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

function ClipBlock({ clip, pxPerSecond, isSelected, isMultiSelected, locked, onSelect, onDragStart, onTrimStart, onTrimEnd }) {
  const left = clip.startTime * pxPerSecond;
  const width = Math.max(40, clip.duration * pxPerSecond);
  const blockRef = useRef(null);
  const inView = useInViewport(blockRef);
  return (
    <div
      ref={blockRef}
      className={`timeline-clip timeline-clip-${clip.type} ${isSelected ? 'timeline-clip-selected' : ''} ${isMultiSelected ? 'timeline-clip-multi-selected' : ''} ${locked ? 'timeline-clip-locked' : ''} ${clip.enabled === false ? 'timeline-clip-disabled' : ''} ${clip.groupId ? 'timeline-clip-grouped' : ''}`}
      style={{ position: 'absolute', left: `${left}px`, width: `${width}px`, top: 0, bottom: 0, ...clipColorStyle(clip.color) }}
      title={[clip.label, clip.enabled === false && '(disabled)', clip.reversed && '(reversed)', clip.frozen && '(frozen)'].filter(Boolean).join(' ')}
      onClick={(e) => { e.stopPropagation(); onSelect?.(clip.id, e); }}
      onMouseDown={(e) => { if (!locked) onDragStart?.(e, clip.id); }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <span className="timeline-clip-handle timeline-clip-handle-left" onMouseDown={(e) => { e.stopPropagation(); if (!locked) onTrimStart?.(e, clip.id, 'left'); }} />
      {inView && clip.type === 'audio' && <ClipWaveform clip={clip} width={width} height={LANE_ROW_HEIGHT} />}
      {inView && clip.type === 'video' && <ClipFilmstrip clip={clip} width={width} height={LANE_ROW_HEIGHT} />}
      {inView && clip.type === 'image' && <ClipStill clip={clip} width={width} height={LANE_ROW_HEIGHT} />}
      <span className="timeline-clip-label">{clip.label}</span>
      <span className="timeline-clip-duration">{formatTime(clip.duration)}</span>
      <span className="timeline-clip-handle timeline-clip-handle-right" onMouseDown={(e) => { e.stopPropagation(); if (!locked) onTrimEnd?.(e, clip.id, 'right'); }} />
    </div>
  );
}

function TrackRow({
  clips, placeholder, pxPerSecond, totalWidth, selectedClipId, selectedClipIds, onSelectClip, onClipDragStart,
  onTrimStart, onTrimEnd, expanded, onPlaceholderClick, trackType, laneIndex, locked, onGapContextMenu,
}) {
  return (
    <div
      className={`timeline-track-row ${locked ? 'timeline-track-row-locked' : ''}`}
      data-track-type={trackType}
      data-track-lane={laneIndex}
      style={{ height: laneHeight(expanded), position: 'relative', width: `${totalWidth}px` }}
      onContextMenu={(e) => {
        if (!onGapContextMenu) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const time = (e.clientX - rect.left) / pxPerSecond;
        onGapContextMenu(e, trackType, laneIndex, time);
      }}
    >
      {clips.length ? clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          pxPerSecond={pxPerSecond}
          isSelected={selectedClipId === clip.id}
          isMultiSelected={selectedClipIds?.includes(clip.id)}
          locked={locked}
          onSelect={onSelectClip}
          onDragStart={onClipDragStart}
          onTrimStart={onTrimStart}
          onTrimEnd={onTrimEnd}
        />
      )) : onPlaceholderClick ? (
        <button type="button" className="timeline-placeholder timeline-placeholder-button" onClick={(e) => { e.stopPropagation(); onPlaceholderClick(e); }} style={{ position: 'absolute', left: 0, top: 0, bottom: 0 }}>
          <span className="timeline-placeholder-icon">+</span>
          <span className="timeline-placeholder-text">{placeholder}</span>
        </button>
      ) : (
        <div className="timeline-placeholder" style={{ position: 'absolute', left: 0, top: 0, bottom: 0 }}>
          <span className="timeline-placeholder-icon">+</span>
          <span className="timeline-placeholder-text">{placeholder}</span>
        </div>
      )}
    </div>
  );
}

function laneLabelFor(type, laneIndex, laneLabels) {
  if (laneLabels?.[laneIndex]) return laneLabels[laneIndex];
  return `${type[0].toUpperCase()}${type.slice(1)} ${laneIndex + 1}`;
}

// Every media type's lane-label column, rendered as its own list so it can
// sit in the sticky left column while `LaneRows` (identical row heights)
// sits in the scrollable track-surface column - CapCut-style unlimited
// stacked lanes per media type, extra lanes existing purely as an "+ Add
// track" affordance (creating an empty lane a clip can be dragged onto).
function LaneLabels({
  type, lanes, laneLabels, expanded, onExpand, onAddClip, onAddTrack, activeTab, trackState,
  onToggleLock, onToggleHidden, onRemoveTrack, onRenameTrack, onReorderTrack,
}) {
  return (
    <>
      {lanes.map((_, laneIndex) => (
        <TrackLabel
          key={`${type}-label-${laneIndex}`}
          type={type}
          label={laneLabelFor(type, laneIndex, laneLabels)}
          expanded={expanded}
          onExpand={onExpand}
          onAddClip={laneIndex === 0 && activeTab === 'editor' ? onAddClip : undefined}
          locked={Boolean(trackState?.[laneIndex]?.locked)}
          hidden={Boolean(trackState?.[laneIndex]?.hidden)}
          onToggleLock={() => onToggleLock?.(type, laneIndex)}
          onToggleHidden={() => onToggleHidden?.(type, laneIndex)}
          onRename={activeTab === 'editor' && onRenameTrack ? (name) => onRenameTrack(type, laneIndex, name) : undefined}
          onRemove={activeTab === 'editor' && onRemoveTrack ? () => onRemoveTrack(type, laneIndex) : undefined}
          canRemove={lanes.length > 1}
          onMoveUp={activeTab === 'editor' && onReorderTrack ? () => onReorderTrack(type, laneIndex, -1) : undefined}
          onMoveDown={activeTab === 'editor' && onReorderTrack ? () => onReorderTrack(type, laneIndex, 1) : undefined}
          canMoveUp={laneIndex > 0}
          canMoveDown={laneIndex < lanes.length - 1}
        />
      ))}
      {activeTab === 'editor' && (
        <div className="timeline-lane-add-label" style={{ height: ADD_TRACK_ROW_HEIGHT }}>
          <button type="button" className="timeline-add-track-button" onClick={() => onAddTrack?.(type)}>+ Add {type} track</button>
        </div>
      )}
    </>
  );
}

function LaneRows({
  type, lanes, pxPerSecond, totalWidth, selectedClipId, selectedClipIds, onSelectClip, onClipDragStart,
  onTrimStart, onTrimEnd, expanded, placeholder, activeTab, trackState, onPlaceholderClick, onGapContextMenu,
}) {
  return (
    <>
      {lanes.map((laneClips, laneIndex) => (
        <TrackRow
          key={`${type}-row-${laneIndex}`}
          clips={laneClips}
          placeholder={laneIndex === 0 ? placeholder : 'Drag a clip here'}
          pxPerSecond={pxPerSecond}
          totalWidth={totalWidth}
          selectedClipId={selectedClipId}
          selectedClipIds={selectedClipIds}
          onSelectClip={onSelectClip}
          onClipDragStart={onClipDragStart}
          onTrimStart={onTrimStart}
          onTrimEnd={onTrimEnd}
          expanded={expanded}
          onPlaceholderClick={laneIndex === 0 && activeTab === 'editor' ? onPlaceholderClick : undefined}
          trackType={type}
          laneIndex={laneIndex}
          locked={Boolean(trackState?.[laneIndex]?.locked)}
          onGapContextMenu={activeTab === 'editor' ? onGapContextMenu : undefined}
        />
      ))}
      {activeTab === 'editor' && <div style={{ height: ADD_TRACK_ROW_HEIGHT, width: `${totalWidth}px` }} />}
    </>
  );
}

function BottomTimeline({
  activeTab, tracks, currentTime, totalDuration, zoom, onZoomChange, onSeek, onSplit, onDelete,
  onTrimStart, onTrimEnd, timelineHeight, onTimelineHeightChange, laneLabels,
  selectedClipId, selectedClipIds, onSelectClip, onClipDragStart, snapEnabled, onSnapToggle, expandedTracks, onTrackExpand, autoFollowPlayhead, onAutoFollowToggle, onPlayheadDragStart, onUndo, onRedo, onAddTextClip, onAddAudioClip, onAddTrack, trackState, onToggleLock, onToggleHidden, onRemoveTrack, onRenameTrack, onReorderTrack,
  onRippleDelete, insertMode, onInsertModeToggle, onGapContextMenu, onGroupSelected, onUngroupSelected, onFreezeFrame, onAddAdjustmentLayer,
  markers, onAddMarker, onRemoveMarker, onRenameMarker, onJumpToMarker,
}) {
  const pxPerSecond = PX_PER_SECOND * (zoom / 100);
  const ruler = getRulerConfig(totalDuration, pxPerSecond);
  const duration = ruler.max;
  const totalWidth = Math.max(1100, duration * pxPerSecond);
  const playheadLeft = `${currentTime * pxPerSecond}px`;
  const minToolbar = 42;
  const minRuler = 26;
  const minTracks = 52 * 3;
  const minHeight = minToolbar + minRuler + minTracks + 18;
  const maxHeight = 520;
  const clampedHeight = Math.max(minHeight, Math.min(maxHeight, timelineHeight || 260));

  const handleResizeStart = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = clampedHeight;
    const handleMouseMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = startHeight + delta;
      onTimelineHeightChange?.(newHeight);
    };
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const laneCount = tracks.video.length + tracks.audio.length + tracks.text.length;
  const laneListProps = { pxPerSecond, totalWidth, selectedClipId, selectedClipIds, onSelectClip, onClipDragStart, onTrimStart, onTrimEnd, activeTab };

  // The label column (`.timeline-track-labels`) and the track-surface
  // column scroll independently in the DOM (only the surface has a visible
  // scrollbar - see `.timeline-track-labels { overflow-y: hidden }` in
  // index.css) but must stay vertically aligned once there are enough
  // lanes to scroll, so mirror scrollTop from the surface onto the labels.
  const labelsRef = useRef(null);
  const trackSurfaceRef = useRef(null);
  // Ruler ticks are absolutely positioned at marker*pxPerSecond inside a
  // track the same width as the scrollable content (totalWidth), so they
  // line up with actual clip positions below - shifted via a direct style
  // mutation on scroll (like labelsRef's scrollTop mirror above) rather
  // than React state, so scrolling doesn't force a re-render per tick.
  const rulerTrackRef = useRef(null);
  const handleSurfaceScroll = (e) => {
    if (labelsRef.current) labelsRef.current.scrollTop = e.currentTarget.scrollTop;
    if (rulerTrackRef.current) rulerTrackRef.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`;
  };

  // Floating frame preview on hover - separate from click-to-seek, never
  // moves the playhead. Throttled and skipped entirely while any mouse
  // button is held (e.buttons !== 0) so it doesn't fire during an active
  // clip drag/trim/playhead-drag gesture, and reuses the already-cached
  // thumbnail strip from ClipFilmstrip (see timeline/thumbnails.js) instead
  // of extracting new frames.
  const [hoverPreview, setHoverPreview] = useState(null);
  const hoverThrottleRef = useRef(0);
  const handleSurfaceMouseMove = (e) => {
    if (e.buttons !== 0) {
      if (hoverPreview) setHoverPreview(null);
      return;
    }
    const now = performance.now();
    if (now - hoverThrottleRef.current < 80) return;
    hoverThrottleRef.current = now;

    const rect = e.currentTarget.getBoundingClientRect();
    const hoverTime = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft) / pxPerSecond);
    const clip = tracks.video.flat().find((c) => hoverTime >= c.startTime && hoverTime <= c.startTime + c.duration);
    if (!clip) {
      setHoverPreview(null);
      return;
    }
    const clipLocalTime = (clip.trimmedStart || 0) + (hoverTime - clip.startTime);
    const cursorX = e.clientX;
    const cursorY = e.clientY;
    getThumbnailStripForClip(clip).then((strip) => {
      if (!strip?.frames?.length) return;
      let nearest = strip.frames[0];
      let bestDelta = Infinity;
      strip.frames.forEach((frame) => {
        const delta = Math.abs(frame.time - clipLocalTime);
        if (delta < bestDelta) {
          bestDelta = delta;
          nearest = frame;
        }
      });
      setHoverPreview({ x: cursorX, y: cursorY, dataUrl: nearest.dataUrl });
    });
  };
  const handleSurfaceMouseLeave = () => setHoverPreview(null);

  // Picks the zoom % that makes the actual content duration exactly fill
  // the visible track-surface width, so the whole timeline is visible with
  // no horizontal scroll - based on totalDuration (real content length),
  // not the padded/rounded `duration` (ruler.max) used for drawing tick
  // marks, so a short project doesn't get zoomed in on the ruler's
  // artificial minimum width.
  const handleFitToWindow = () => {
    const visibleWidth = trackSurfaceRef.current?.clientWidth;
    if (!visibleWidth || !totalDuration) return;
    const fitZoom = (visibleWidth / totalDuration / PX_PER_SECOND) * 100;
    onZoomChange(Math.max(10, Math.min(400, Math.floor(fitZoom))));
  };

  return (
    <section className="timeline-shell" style={{ height: clampedHeight }}>
      <div className="timeline-resize-handle" onMouseDown={handleResizeStart} title="Drag to resize timeline" />
      <div className="timeline-toolbar">
        <div className="timeline-tool-group">
          <button type="button" className="timeline-action-button" onClick={onSplit}>Split</button>
          <button type="button" className="timeline-action-button" title="Split and hold the frame under the playhead for 2s" onClick={onFreezeFrame}>Freeze Frame</button>
          <button type="button" className="timeline-action-button" title="Add a color/vignette adjustment layer affecting every video lane below it" onClick={onAddAdjustmentLayer}>+ Adjustment Layer</button>
          <button type="button" className="timeline-action-button" title="Add a marker at the playhead" onClick={onAddMarker}>+ Marker</button>
          <button type="button" className="timeline-action-button" onClick={onDelete}>Delete</button>
          <button type="button" className="timeline-action-button" title="Delete and close the gap on this lane (Shift+Delete)" onClick={onRippleDelete}>Ripple Delete</button>
          <button type="button" className="timeline-action-button" title="Bundle the selected clips so they drag together (Alt+G)" onClick={onGroupSelected}>Group</button>
          <button type="button" className="timeline-action-button" title="Undo grouping (Alt+Shift+G)" onClick={onUngroupSelected}>Ungroup</button>
          <span className="timeline-tool-divider"/>
          <button type="button" className="timeline-action-button" onClick={onSnapToggle}>
            <span className={`timeline-magnet ${snapEnabled ? 'timeline-magnet-active' : ''}`} />
            {snapEnabled ? 'Snap On' : 'Snap Off'}
          </button>
          <button type="button" className="timeline-action-button" onClick={onAutoFollowToggle}>
            {autoFollowPlayhead ? 'Follow On' : 'Follow Off'}
          </button>
          <button type="button" className={`timeline-action-button ${insertMode ? 'is-active' : ''}`} title="When on (or while holding Alt), dropping a dragged clip pushes clips on that lane forward instead of overwriting" onClick={onInsertModeToggle}>
            {insertMode ? 'Insert On' : 'Insert Off'}
          </button>
          <span className="timeline-tool-divider"/>
          <button type="button" className="timeline-action-button" onClick={onUndo}>Undo</button>
          <button type="button" className="timeline-action-button" onClick={onRedo}>Redo</button>
        </div>
        <div className="timeline-toolbar-spacer"/>
        <div className="timeline-zoom-controls">
          <button type="button" className="timeline-action-button" title="Fit the whole timeline to the visible width" onClick={handleFitToWindow}>Fit</button>
          <button type="button" className="timeline-action-button" onClick={() => onZoomChange(Math.max(10, zoom - 10))}>−</button>
          <input aria-label="Timeline zoom" type="range" min="10" max="400" value={zoom} onChange={(event) => onZoomChange(Number(event.target.value))}/>
          <button type="button" className="timeline-action-button" onClick={() => onZoomChange(Math.min(400, zoom + 10))}>+</button>
        </div>
      </div>
      {activeTab === 'editor' && markers?.length > 0 && (
        <div className="timeline-markers-list">
          {markers.map((marker) => (
            <MarkerChip key={marker.id} marker={marker} onJump={onJumpToMarker} onRename={onRenameMarker} onRemove={onRemoveMarker} />
          ))}
        </div>
      )}
      <TimelineMinimap tracks={tracks} duration={duration} totalWidth={totalWidth} trackSurfaceRef={trackSurfaceRef} />
      <div className="timeline-ruler">
        <div className="timeline-ruler-offset"><span>{laneCount} tracks · {formatTime(duration)}</span></div>
        <div className="timeline-ruler-markers">
          <div className="timeline-ruler-markers-track" ref={rulerTrackRef} style={{ width: `${totalWidth}px` }}>
            {ruler.markers.map((marker) => (
              <span key={marker} className="timeline-ruler-tick" style={{ left: `${marker * pxPerSecond}px` }}>
                {formatTime(marker, ruler.decimals)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="timeline-tracks">
        <div className="timeline-track-labels" ref={labelsRef}>
          <LaneLabels type="text" lanes={tracks.text} laneLabels={laneLabels?.text} expanded={expandedTracks.text} onExpand={() => onTrackExpand('text')} onAddClip={onAddTextClip} onAddTrack={onAddTrack} activeTab={activeTab} trackState={trackState?.text} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
          <LaneLabels type="video" lanes={tracks.video} laneLabels={laneLabels?.video} expanded={expandedTracks.video} onExpand={() => onTrackExpand('video')} onAddTrack={onAddTrack} activeTab={activeTab} trackState={trackState?.video} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
          <LaneLabels type="audio" lanes={tracks.audio} laneLabels={laneLabels?.audio} expanded={expandedTracks.audio} onExpand={() => onTrackExpand('audio')} onAddClip={onAddAudioClip} onAddTrack={onAddTrack} activeTab={activeTab} trackState={trackState?.audio} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
        </div>
        <div
          className="timeline-track-surface"
          ref={trackSurfaceRef}
          onScroll={handleSurfaceScroll}
          onMouseMove={handleSurfaceMouseMove}
          onMouseLeave={handleSurfaceMouseLeave}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek(Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft) / pxPerSecond));
          }}
        >
          <div
            className="timeline-playhead"
            style={{ left: playheadLeft }}
            onMouseDown={onPlayheadDragStart}
          >
            <span className="timeline-playhead-time">{formatTime(currentTime)}</span>
            <span className="timeline-playhead-handle"/>
          </div>
          {activeTab === 'editor' && markers?.map((marker) => (
            <MarkerTick key={marker.id} marker={marker} pxPerSecond={pxPerSecond} onJump={onJumpToMarker} onRemove={onRemoveMarker} />
          ))}
          <LaneRows type="text" lanes={tracks.text} expanded={expandedTracks.text} placeholder="Add text or captions" trackState={trackState?.text} onPlaceholderClick={onAddTextClip} onGapContextMenu={onGapContextMenu} {...laneListProps} />
          <LaneRows type="video" lanes={tracks.video} expanded={expandedTracks.video} placeholder={activeTab === 'editor' ? 'Drag media here' : 'Drop clips here'} trackState={trackState?.video} onGapContextMenu={onGapContextMenu} {...laneListProps} />
          <LaneRows type="audio" lanes={tracks.audio} expanded={expandedTracks.audio} placeholder="Add audio" trackState={trackState?.audio} onPlaceholderClick={onAddAudioClip} onGapContextMenu={onGapContextMenu} {...laneListProps} />
        </div>
      </div>
      <HoverScrubPreview preview={hoverPreview} />
    </section>
  );
}

export default BottomTimeline;

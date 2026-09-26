import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getWaveformForClip, sliceWaveform } from '../timeline/waveform';
import { getThumbnailStripForClip, framesForTrimWindow } from '../timeline/thumbnails';
import { formatTimecode } from '../timeline/timecode';
import { laneCode, laneName } from '../timeline/laneNames';
import { PX_PER_SECOND, ZOOM_STEP, fitZoom, pxPerSecondFor, rulerTicks, sliderToZoom, zoomToSlider, SLIDER_RANGE, clampZoom } from '../timeline/zoom';
import { MEDIA_DRAG_TYPE, getMediaDrag } from '../timeline/mediaDrag';

function HoverScrubPreview({ preview }) {
  if (!preview) return null;
  return (
    <div className="timeline-hover-preview" style={{ left: `${preview.x}px`, top: `${preview.y}px` }}>
      <img src={preview.dataUrl} alt="" />
    </div>
  );
}

// Pixels-per-second at 100% zoom (see timeline/zoom.js) - re-exported for
// App.jsx's drag/trim math so screen deltas and stored time deltas agree.
export { PX_PER_SECOND };

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

const Icon = ({ d, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICON = {
  undo: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  split: 'M12 3v18 M8 8l-4 4 4 4 M16 8l4 4-4 4',
  trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3 M6 7h4 M14 7h4',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18 M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2 M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 7.5-2',
  plus: 'M12 5v14 M5 12h14',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  close: 'M6 6l12 12 M18 6 6 18',
  expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-4.35-4.35 M8 11h6',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-4.35-4.35 M8 11h6 M11 8v6',
};

export const LANE_ROW_HEIGHT = 64;
const LANE_ROW_HEIGHT_EXPANDED = 80;

// Height of a lane's row, kept identical between the label column and the
// track-surface column so the two side-by-side lists stay aligned. Exported
// so App.jsx's vertical clip-drag math can use the same per-type row height
// (a type's lanes are expanded/collapsed as a group, so one height covers
// every lane of that type).
// eslint-disable-next-line react-refresh/only-export-components
export function laneHeight(expanded) {
  return expanded ? LANE_ROW_HEIGHT_EXPANDED : LANE_ROW_HEIGHT;
}

// Overlay/title lanes sit ABOVE the main lane, like every NLE: V2 is drawn
// over V1, so it's listed above it (T2 above T1 likewise). Audio lanes read
// top-down (A1, then A2 under it). App.jsx's vertical drag math mirrors this
// (see laneDirection there).
// eslint-disable-next-line react-refresh/only-export-components
export function displayOrder(type, laneCount) {
  const order = Array.from({ length: laneCount }, (_, i) => i);
  return type === 'audio' ? order : order.reverse();
}

function TrackLabel({
  type, laneIndex, name, expanded, onExpand, onAddClip, locked, hidden, onToggleLock, onToggleHidden,
  onRename, onRemove, canRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const startEditing = () => {
    if (!onRename) return;
    setDraft(name);
    setEditing(true);
  };
  const commitEditing = () => {
    setEditing(false);
    onRename?.(draft);
  };
  const hideLabel = type === 'audio' ? (hidden ? 'Unmute track' : 'Mute track') : (hidden ? 'Show track' : 'Hide track');

  return (
    <div className={`st-track-label ${hidden ? 'is-hidden' : ''}`} style={{ height: laneHeight(expanded) }}>
      <div className="st-track-title">
        <b>{laneCode(type, laneIndex)}</b>
        {editing ? (
          <input
            type="text"
            className="st-track-rename"
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
          <span title={onRename ? 'Double-click to rename' : undefined} onDoubleClick={startEditing}>{name}</span>
        )}
      </div>
      <div className="st-track-icons">
        <button type="button" className={hidden ? 'is-on' : ''} title={hideLabel} aria-label={hideLabel} aria-pressed={hidden} onClick={onToggleHidden}>
          <Icon d={hidden ? ICON.eyeOff : ICON.eye} size={13} />
        </button>
        <button type="button" className={locked ? 'is-on' : ''} title={locked ? 'Unlock track' : 'Lock track'} aria-label={locked ? 'Unlock track' : 'Lock track'} aria-pressed={locked} onClick={onToggleLock}>
          <Icon d={locked ? ICON.lock : ICON.unlock} size={13} />
        </button>
        <span className="st-track-more">
          {onAddClip && <button type="button" title={`Add ${type}`} aria-label={`Add ${type}`} onClick={onAddClip}><Icon d={ICON.plus} size={12} /></button>}
          <button type="button" title={expanded ? 'Shorter rows' : 'Taller rows'} aria-label="Toggle row height" onClick={onExpand}><Icon d={ICON.expand} size={12} /></button>
          {onMoveUp && <button type="button" title="Move track up" aria-label="Move track up" disabled={!canMoveUp} onClick={onMoveUp}><Icon d={ICON.up} size={12} /></button>}
          {onMoveDown && <button type="button" title="Move track down" aria-label="Move track down" disabled={!canMoveDown} onClick={onMoveDown}><Icon d={ICON.down} size={12} /></button>}
          {onRemove && <button type="button" title="Remove track" aria-label="Remove track" disabled={!canRemove} onClick={onRemove}><Icon d={ICON.close} size={12} /></button>}
        </span>
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
    // At deep zoom a clip can be hundreds of thousands of pixels wide - far
    // past what a canvas can hold - so the bar count is capped and the
    // canvas is stretched to the clip's width instead.
    const bucketCount = Math.max(1, Math.min(4096, Math.round(width)));
    const dpr = bucketCount * (window.devicePixelRatio || 1) > 8192 ? 1 : (window.devicePixelRatio || 1);
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

const KEYFRAME_TRACKS = ['x', 'y', 'rotation', 'opacity', 'scaleX', 'scaleY', 'volume'];

// Every distinct keyframe time on the clip (output-local seconds), for the
// yellow diamonds drawn on its block.
function keyframeTimes(clip) {
  const times = new Set();
  KEYFRAME_TRACKS.forEach((prop) => {
    (clip.keyframes?.[prop] || []).forEach((point) => {
      if (Number.isFinite(point?.t)) times.add(Math.round(point.t * 100) / 100);
    });
  });
  return [...times].filter((t) => t >= 0 && t <= clip.duration + 0.01).sort((a, b) => a - b);
}

function clipKind(clip, laneIndex) {
  if (clip.type === 'text' || clip.type === 'audio' || clip.type === 'adjustment') return clip.type;
  return laneIndex > 0 ? 'overlay' : clip.type === 'image' ? 'image' : 'video';
}

function clipLabel(clip) {
  if (clip.type === 'text') return `T · ${clip.label}`;
  if (clip.type === 'audio') return `♪ ${clip.label}`;
  return clip.label;
}

function ClipBlock({ clip, laneIndex, rowHeight, pxPerSecond, isSelected, isMultiSelected, locked, onSelect, onDragStart, onTrimStart, onTrimEnd }) {
  const left = clip.startTime * pxPerSecond;
  const width = Math.max(40, clip.duration * pxPerSecond);
  const blockRef = useRef(null);
  const inView = useInViewport(blockRef);
  const kind = clipKind(clip, laneIndex);
  const stripHeight = rowHeight - 8;
  const diamonds = inView && clip.type !== 'audio' && clip.type !== 'text' ? keyframeTimes(clip) : [];
  return (
    <div
      ref={blockRef}
      className={`st-clip st-clip-${kind} ${isSelected ? 'is-selected' : ''} ${isMultiSelected ? 'is-multi' : ''} ${locked ? 'is-locked' : ''} ${clip.enabled === false ? 'is-disabled' : ''} ${clip.groupId ? 'is-grouped' : ''}`}
      style={{ left: `${left}px`, width: `${width}px`, ...clipColorStyle(clip.color) }}
      title={[clip.label, clip.enabled === false && '(disabled)', clip.reversed && '(reversed)', clip.frozen && '(frozen)'].filter(Boolean).join(' ')}
      onClick={(e) => { e.stopPropagation(); onSelect?.(clip.id, e); }}
      onMouseDown={(e) => { if (!locked) onDragStart?.(e, clip.id); }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {inView && clip.type === 'audio' && <ClipWaveform clip={clip} width={width} height={stripHeight} />}
      {inView && (clip.type === 'video') && <ClipFilmstrip clip={clip} width={width} height={stripHeight} />}
      {inView && clip.type === 'image' && <ClipStill clip={clip} width={width} height={stripHeight} />}
      <span className="st-clip-handle is-left" onMouseDown={(e) => { e.stopPropagation(); if (!locked) onTrimStart?.(e, clip.id, 'left'); }} />
      <span className="st-clip-label">{clipLabel(clip)}</span>
      <span className="st-clip-duration">{formatTime(clip.duration)}</span>
      {diamonds.map((t) => (
        <i key={t} className="st-clip-keyframe" style={{ left: `${t * pxPerSecond}px` }} aria-hidden="true" />
      ))}
      <span className="st-clip-handle is-right" onMouseDown={(e) => { e.stopPropagation(); if (!locked) onTrimEnd?.(e, clip.id, 'right'); }} />
    </div>
  );
}

function TrackRow({
  clips, placeholder, pxPerSecond, totalWidth, selectedClipId, selectedClipIds, onSelectClip, onClipDragStart,
  onTrimStart, onTrimEnd, expanded, onPlaceholderClick, trackType, laneIndex, locked, hidden, onGapContextMenu,
}) {
  const rowHeight = laneHeight(expanded);
  return (
    <div
      className={`st-track-row ${locked ? 'is-locked' : ''} ${hidden ? 'is-hidden' : ''}`}
      data-track-type={trackType}
      data-track-lane={laneIndex}
      style={{ height: rowHeight, width: `${totalWidth}px` }}
      onContextMenu={(e) => {
        if (!onGapContextMenu) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const time = (e.clientX - rect.left) / pxPerSecond;
        onGapContextMenu(e, trackType, laneIndex, time);
      }}
    >
      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          laneIndex={laneIndex}
          rowHeight={rowHeight}
          pxPerSecond={pxPerSecond}
          isSelected={selectedClipId === clip.id}
          isMultiSelected={selectedClipIds?.includes(clip.id)}
          locked={locked}
          onSelect={onSelectClip}
          onDragStart={onClipDragStart}
          onTrimStart={onTrimStart}
          onTrimEnd={onTrimEnd}
        />
      ))}
      {!clips.length && placeholder && (
        onPlaceholderClick ? (
          <button type="button" className="st-track-hint" onClick={(e) => { e.stopPropagation(); onPlaceholderClick(e); }}>+ {placeholder}</button>
        ) : <span className="st-track-hint">{placeholder}</span>
      )}
    </div>
  );
}

function LaneLabels({
  type, lanes, laneLabels, expanded, onExpand, onAddClip, activeTab, trackState,
  onToggleLock, onToggleHidden, onRemoveTrack, onRenameTrack, onReorderTrack,
}) {
  const editor = activeTab === 'editor';
  const reversed = type !== 'audio';
  return displayOrder(type, lanes.length).map((laneIndex) => {
    // "Up" on screen is a higher lane index for the reversed (video/text)
    // groups and a lower one for audio.
    const upDelta = reversed ? 1 : -1;
    const canUp = reversed ? laneIndex < lanes.length - 1 : laneIndex > 0;
    const canDown = reversed ? laneIndex > 0 : laneIndex < lanes.length - 1;
    return (
      <TrackLabel
        key={`${type}-label-${laneIndex}`}
        type={type}
        laneIndex={laneIndex}
        name={laneName(type, laneIndex, laneLabels?.[laneIndex])}
        expanded={expanded}
        onExpand={onExpand}
        onAddClip={laneIndex === 0 && editor ? onAddClip : undefined}
        locked={Boolean(trackState?.[laneIndex]?.locked)}
        hidden={Boolean(trackState?.[laneIndex]?.hidden)}
        onToggleLock={() => onToggleLock?.(type, laneIndex)}
        onToggleHidden={() => onToggleHidden?.(type, laneIndex)}
        onRename={editor && onRenameTrack ? (name) => onRenameTrack(type, laneIndex, name) : undefined}
        onRemove={editor && onRemoveTrack ? () => onRemoveTrack(type, laneIndex) : undefined}
        canRemove={lanes.length > 1}
        onMoveUp={editor && onReorderTrack ? () => onReorderTrack(type, laneIndex, upDelta) : undefined}
        onMoveDown={editor && onReorderTrack ? () => onReorderTrack(type, laneIndex, -upDelta) : undefined}
        canMoveUp={canUp}
        canMoveDown={canDown}
      />
    );
  });
}

function LaneRows({
  type, lanes, pxPerSecond, totalWidth, selectedClipId, selectedClipIds, onSelectClip, onClipDragStart,
  onTrimStart, onTrimEnd, expanded, placeholder, activeTab, trackState, onPlaceholderClick, onGapContextMenu,
}) {
  return displayOrder(type, lanes.length).map((laneIndex) => (
    <TrackRow
      key={`${type}-row-${laneIndex}`}
      clips={lanes[laneIndex]}
      placeholder={laneIndex === 0 ? placeholder : ''}
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
      hidden={Boolean(trackState?.[laneIndex]?.hidden)}
      onGapContextMenu={activeTab === 'editor' ? onGapContextMenu : undefined}
    />
  ));
}

// The time ruler. Only the ticks inside the visible window (plus a margin)
// are rendered - a zoomed-in multi-hour project would otherwise mean
// hundreds of thousands of tick elements. It follows the track surface's
// horizontal scroll directly (a style write on every scroll event, so it
// never lags) and re-picks its visible ticks at most once per frame.
function Ruler({ surfaceRef, pxPerSecond, fps, totalWidth, currentTime, onSeek, onPlayheadDragStart }) {
  const trackRef = useRef(null);
  const [view, setView] = useState({ left: 0, width: 1600 });

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    let frame = 0;
    const sync = () => {
      frame = 0;
      setView((prev) => (prev.left === surface.scrollLeft && prev.width === surface.clientWidth ? prev : { left: surface.scrollLeft, width: surface.clientWidth }));
    };
    const onScroll = () => {
      if (trackRef.current) trackRef.current.style.transform = `translateX(${-surface.scrollLeft}px)`;
      if (!frame) frame = requestAnimationFrame(sync);
    };
    frame = requestAnimationFrame(sync);
    surface.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    observer?.observe(surface);
    return () => {
      surface.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [surfaceRef]);

  const margin = 240;
  const from = Math.max(0, (view.left - margin) / pxPerSecond);
  const to = (view.left + view.width + margin) / pxPerSecond;
  const { major, minor } = rulerTicks(pxPerSecond, fps, from, to);

  return (
    <div
      className="st-ruler-track"
      ref={trackRef}
      style={{ width: `${totalWidth}px`, transform: `translateX(${-view.left}px)` }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, (e.clientX - rect.left) / pxPerSecond));
      }}
    >
      {minor.map((t) => <i key={`m${t}`} className="st-tick-minor" style={{ left: `${t * pxPerSecond}px` }} />)}
      {major.map((tick) => (
        <span key={tick.t} className={`st-tick ${tick.label.endsWith('f') ? 'is-frame' : ''}`} style={{ left: `${tick.t * pxPerSecond}px` }}>
          {tick.label}
        </span>
      ))}
      <span className="st-playhead-pin" style={{ left: `${currentTime * pxPerSecond}px` }} onMouseDown={(e) => { e.stopPropagation(); onPlayheadDragStart?.(e); }} />
    </div>
  );
}

// The "⋯" menu: every timeline tool that isn't one of the four toolbar
// icons, grouped, so the toolbar stays as clean as the studio design while
// nothing that existed before is lost.
function MoreMenu({ items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  // The menu opens upward from the toolbar; it gets exactly the room between
  // the toolbar and the app's top bar and scrolls if it needs more.
  useLayoutEffect(() => {
    const top = ref.current?.parentElement?.getBoundingClientRect().top;
    if (Number.isFinite(top)) ref.current.style.maxHeight = `${Math.max(160, top - 76)}px`;
  }, []);
  return (
    <div className="st-menu" role="menu" ref={ref}>
      {items.map((group) => (
        <div className="st-menu-group" key={group.title}>
          <span className="st-menu-title">{group.title}</span>
          {group.items.filter(Boolean).map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              onClick={() => { item.onClick?.(); if (item.checked === undefined) onClose(); }}
            >
              <span>{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
              {item.checked !== undefined && <i className={`st-check ${item.checked ? 'is-on' : ''}`} aria-hidden="true" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function BottomTimeline({
  activeTab, tracks, currentTime, totalDuration, zoom, onZoomChange, onSeek, onSplit, onDelete,
  onTrimStart, onTrimEnd, timelineHeight, onTimelineHeightChange, laneLabels, fps = 30, contentDuration,
  selectedClipId, selectedClipIds, onSelectClip, onClipDragStart, snapEnabled, onSnapToggle, expandedTracks, onTrackExpand, autoFollowPlayhead, onAutoFollowToggle, onPlayheadDragStart, onUndo, onRedo, onAddTextClip, onAddAudioClip, onAddTrack, trackState, onToggleLock, onToggleHidden, onRemoveTrack, onRenameTrack, onReorderTrack,
  onRippleDelete, insertMode, onInsertModeToggle, onGapContextMenu, onGroupSelected, onUngroupSelected, onFreezeFrame, onAddAdjustmentLayer, onAutoCaptions, captionsStatus,
  markers, onAddMarker, onRemoveMarker, onRenameMarker, onJumpToMarker, onDropMedia,
}) {
  const pxPerSecond = pxPerSecondFor(zoom);
  const duration = Math.max(0, Number(totalDuration) || 0);
  const [surfaceWidth, setSurfaceWidth] = useState(1100);
  // Always a screen's worth of empty timeline after the end (like CapCut):
  // it keeps the last clip off the edge, and it's what lets zooming stay
  // anchored on the playhead even when the project is shorter than the view.
  const totalWidth = Math.max(surfaceWidth, duration * pxPerSecond + surfaceWidth * 0.9);
  const playheadLeft = `${currentTime * pxPerSecond}px`;
  const minHeight = 48 + 32 + 64 * 3 + 12;
  const maxHeight = 560;
  const clampedHeight = Math.max(minHeight, Math.min(maxHeight, timelineHeight || 330));
  const [menuOpen, setMenuOpen] = useState(false);

  const handleResizeStart = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = clampedHeight;
    const handleMouseMove = (moveEvent) => {
      // Dragging the top edge up makes the timeline taller.
      onTimelineHeightChange?.(startHeight - (moveEvent.clientY - startY));
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

  // The label column and the track-surface column scroll independently but
  // must stay vertically aligned, so scrollTop is mirrored from the surface
  // onto the labels; the ruler follows scrollLeft the same way (a direct
  // style write, not React state, so scrolling never re-renders).
  const labelsRef = useRef(null);
  const trackSurfaceRef = useRef(null);
  const rulerBodyRef = useRef(null);
  const handleSurfaceScroll = (e) => {
    if (labelsRef.current) labelsRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  useEffect(() => {
    const surface = trackSurfaceRef.current;
    if (!surface || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => setSurfaceWidth(surface.clientWidth || 1100));
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  // ---- Zoom -------------------------------------------------------------
  // Every zoom change keeps one point of the timeline still on screen: the
  // mouse position for Ctrl+wheel / pinch, otherwise the playhead (or the
  // middle of the view when the playhead is scrolled out of sight). The
  // scroll correction runs right after the new widths are laid out, so the
  // content never visibly jumps.
  const zoomRef = useRef(zoom);
  const pxRef = useRef(pxPerSecond);
  const timeRef = useRef(currentTime);
  const anchorRef = useRef(null);
  const onZoomChangeRef = useRef(onZoomChange);
  useEffect(() => {
    zoomRef.current = zoom;
    timeRef.current = currentTime;
    onZoomChangeRef.current = onZoomChange;
  });

  useLayoutEffect(() => {
    const surface = trackSurfaceRef.current;
    const previousPx = pxRef.current;
    pxRef.current = pxPerSecond;
    if (!surface || previousPx === pxPerSecond) return;
    let anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) {
      const playheadX = timeRef.current * previousPx - surface.scrollLeft;
      anchor = playheadX >= 0 && playheadX <= surface.clientWidth
        ? { time: timeRef.current, x: playheadX }
        : { time: (surface.scrollLeft + surface.clientWidth / 2) / previousPx, x: surface.clientWidth / 2 };
    }
    surface.scrollLeft = Math.max(0, anchor.time * pxPerSecond - anchor.x);
  }, [pxPerSecond]);

  const zoomTo = (nextZoom, anchor = null) => {
    const clamped = clampZoom(nextZoom);
    if (Math.abs(clamped - zoomRef.current) < 1e-6) return;
    anchorRef.current = anchor;
    zoomRef.current = clamped;
    onZoomChangeRef.current?.(clamped);
  };
  const zoomToRef = useRef(zoomTo);
  useEffect(() => { zoomToRef.current = zoomTo; });

  // Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as a
  // ctrl+wheel) zooms around the pointer. Registered by hand because React's
  // onWheel is passive and can't stop the browser's own page zoom.
  useEffect(() => {
    const targets = [trackSurfaceRef.current, rulerBodyRef.current].filter(Boolean);
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const surface = trackSurfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      const time = (surface.scrollLeft + x) / pxRef.current;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomToRef.current(zoomRef.current * Math.exp(-delta * 0.0025), { time, x });
    };
    targets.forEach((target) => target.addEventListener('wheel', onWheel, { passive: false }));
    return () => targets.forEach((target) => target.removeEventListener('wheel', onWheel));
  }, []);

  const handleFitToWindow = () => {
    const visibleWidth = trackSurfaceRef.current?.clientWidth;
    const length = contentDuration || totalDuration;
    if (!visibleWidth || !length) return;
    zoomTo(fitZoom(length, visibleWidth - 32), { time: 0, x: 0 });
  };
  const fitRef = useRef(handleFitToWindow);
  useEffect(() => { fitRef.current = handleFitToWindow; });

  // CapCut's shortcuts: Ctrl/Cmd + = zoom in, Ctrl/Cmd + - zoom out (these
  // replace the browser's page zoom while the editor is open), Shift+Z fit.
  useEffect(() => {
    if (activeTab !== 'editor') return undefined;
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const el = document.activeElement;
      const typing = el?.tagName === 'TEXTAREA' || el?.isContentEditable || (el?.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(el.type));
      if (mod && !e.altKey && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) {
        e.preventDefault();
        zoomToRef.current(zoomRef.current * ZOOM_STEP);
      } else if (mod && !e.altKey && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) {
        e.preventDefault();
        zoomToRef.current(zoomRef.current / ZOOM_STEP);
      } else if (!mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        fitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab]);

  // ---- Media dropped from the bin ----------------------------------------
  // Where a dragged media-bin item would land: its own kind of lane under
  // the pointer, or - dropped in the top quarter of the highest video lane,
  // or on a text lane above it - a brand-new video track on top (how you
  // put a video above another, CapCut-style).
  const [dropGhost, setDropGhost] = useState(null);
  const resolveDrop = (e) => {
    const item = getMediaDrag();
    const surface = trackSurfaceRef.current;
    if (!item || !surface) return null;
    const rect = surface.getBoundingClientRect();
    const time = Math.max(0, (e.clientX - rect.left + surface.scrollLeft) / pxPerSecond);
    const type = item.kind === 'audio' ? 'audio' : 'video';
    const row = e.target?.closest?.('.st-track-row');
    let lane = 0;
    let newLane = false;
    if (row) {
      const rowType = row.dataset.trackType;
      const rowLane = Number(row.dataset.trackLane) || 0;
      if (rowType === type) {
        lane = rowLane;
        const box = row.getBoundingClientRect();
        if (type === 'video' && rowLane === tracks.video.length - 1 && e.clientY < box.top + box.height * 0.25) newLane = true;
      } else if (type === 'video' && rowType === 'text') {
        newLane = true;
      }
    }
    return { type, lane, newLane, time, duration: item.duration || 5, label: item.name, mediaId: item.id };
  };

  const ghostFor = (target) => {
    const surface = trackSurfaceRef.current;
    const lane = target.newLane ? tracks[target.type].length - 1 : target.lane;
    const row = surface?.querySelector(`.st-track-row[data-track-type="${target.type}"][data-track-lane="${lane}"]`);
    if (!row) return null;
    return {
      left: Math.round(target.time * pxPerSecond),
      width: Math.max(40, Math.round(target.duration * pxPerSecond)),
      top: target.newLane ? row.offsetTop - 3 : row.offsetTop + 4,
      height: target.newLane ? 0 : row.offsetHeight - 8,
      newLane: target.newLane,
      label: target.label,
      kind: target.type,
    };
  };

  const handleMediaDragOver = (e) => {
    if (!onDropMedia || !e.dataTransfer?.types?.includes(MEDIA_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const target = resolveDrop(e);
    const ghost = target && ghostFor(target);
    setDropGhost((prev) => (
      prev && ghost && prev.left === ghost.left && prev.top === ghost.top && prev.newLane === ghost.newLane ? prev : ghost
    ));
  };

  const handleMediaDrop = (e) => {
    if (!onDropMedia || !e.dataTransfer?.types?.includes(MEDIA_DRAG_TYPE)) return;
    e.preventDefault();
    const target = resolveDrop(e);
    setDropGhost(null);
    if (target) onDropMedia(target);
  };

  // Floating frame preview on hover - separate from click-to-seek, never
  // moves the playhead, skipped while any mouse button is held, and reuses
  // the cached filmstrip frames (see timeline/thumbnails.js).
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
    if (!clip || clip.type !== 'video') {
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


  const menuItems = [
    {
      title: 'Edit',
      items: [
        { label: 'Freeze frame', onClick: onFreezeFrame },
        { label: 'Ripple delete', hint: 'Shift+Del', onClick: onRippleDelete },
        { label: 'Group clips', hint: 'Alt+G', onClick: onGroupSelected },
        { label: 'Ungroup', hint: 'Alt+Shift+G', onClick: onUngroupSelected },
        { label: 'Add marker at playhead', onClick: onAddMarker },
        { label: 'Add adjustment layer', onClick: onAddAdjustmentLayer },
      ],
    },
    {
      title: 'Add',
      items: [
        onAddTextClip && { label: 'Text', onClick: onAddTextClip },
        onAutoCaptions && { label: captionsStatus ? 'Auto captions (working...)' : 'Auto captions', onClick: onAutoCaptions },
        onAddAudioClip && { label: 'Audio', onClick: onAddAudioClip },
        onAddTrack && { label: 'Video track', onClick: () => onAddTrack('video') },
        onAddTrack && { label: 'Text track', onClick: () => onAddTrack('text') },
        onAddTrack && { label: 'Audio track', onClick: () => onAddTrack('audio') },
      ],
    },
    {
      title: 'Options',
      items: [
        { label: 'Follow playhead', checked: Boolean(autoFollowPlayhead), onClick: onAutoFollowToggle },
        { label: 'Insert mode (push clips)', checked: Boolean(insertMode), onClick: onInsertModeToggle },
        { label: 'Fit timeline to window', hint: 'Shift+Z', onClick: handleFitToWindow },
      ],
    },
  ];

  return (
    <section className="st-timeline" style={{ height: clampedHeight }}>
      <div className="st-timeline-resize" onMouseDown={handleResizeStart} title="Drag to resize the timeline" />
      <div className="st-timeline-toolbar">
        <div className="st-tool-group">
          <button type="button" className="st-tool" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={onUndo}><Icon d={ICON.undo} size={17} /></button>
          <button type="button" className="st-tool" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={onRedo}><Icon d={ICON.redo} size={17} /></button>
          <button type="button" className="st-tool" title="Split at playhead (S)" aria-label="Split" onClick={onSplit}><Icon d={ICON.split} size={17} /></button>
          <button type="button" className="st-tool" title="Delete (Del)" aria-label="Delete" onClick={onDelete}><Icon d={ICON.trash} size={17} /></button>
          <button type="button" className={`st-snap ${snapEnabled ? 'is-on' : ''}`} aria-pressed={Boolean(snapEnabled)} title="Snap clips to edges and the playhead" onClick={onSnapToggle}>
            <Icon d={ICON.magnet} size={15} />
            Snap
          </button>
          <div className="st-more-wrap">
            <button type="button" className={`st-tool ${menuOpen ? 'is-active' : ''}`} title="More tools" aria-label="More tools" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Icon d={ICON.more} size={18} /></button>
            {menuOpen && <MoreMenu items={menuItems} onClose={() => setMenuOpen(false)} />}
          </div>
        </div>
        <div className="st-timeline-meta">
          {captionsStatus && <span className="st-busy" role="status">Captions: {captionsStatus}</span>}
          <span>{laneCount} tracks · {formatTimecode(contentDuration ?? totalDuration, fps)}</span>
          <span className="st-zoom-group">
            <button type="button" className="st-zoom-btn" title="Zoom out (Ctrl + -)" aria-label="Zoom out" onClick={() => zoomTo(zoom / ZOOM_STEP)}><Icon d={ICON.zoomOut} size={16} /></button>
            <input
              className="st-zoom"
              aria-label="Timeline zoom"
              title="Zoom - Ctrl + wheel over the timeline, Ctrl + / Ctrl -, Shift+Z to fit"
              type="range"
              min="0"
              max={SLIDER_RANGE}
              value={zoomToSlider(zoom)}
              style={{ '--fill': `${(zoomToSlider(zoom) / SLIDER_RANGE) * 100}%` }}
              onChange={(event) => zoomTo(sliderToZoom(Number(event.target.value)))}
            />
            <button type="button" className="st-zoom-btn" title="Zoom in (Ctrl + =)" aria-label="Zoom in" onClick={() => zoomTo(zoom * ZOOM_STEP)}><Icon d={ICON.zoomIn} size={16} /></button>
          </span>
        </div>
      </div>
      {activeTab === 'editor' && markers?.length > 0 && (
        <div className="timeline-markers-list st-markers">
          {markers.map((marker) => (
            <MarkerChip key={marker.id} marker={marker} onJump={onJumpToMarker} onRename={onRenameMarker} onRemove={onRemoveMarker} />
          ))}
        </div>
      )}
      <div className="st-ruler">
        <div className="st-ruler-gutter" />
        <div className="st-ruler-body" ref={rulerBodyRef}>
          <Ruler surfaceRef={trackSurfaceRef} pxPerSecond={pxPerSecond} fps={fps} totalWidth={totalWidth} currentTime={currentTime} onSeek={onSeek} onPlayheadDragStart={onPlayheadDragStart} />
        </div>
      </div>
      <div className="st-tracks">
        <div className="st-track-labels" ref={labelsRef}>
          <LaneLabels type="text" lanes={tracks.text} laneLabels={laneLabels?.text} expanded={expandedTracks.text} onExpand={() => onTrackExpand('text')} onAddClip={onAddTextClip} activeTab={activeTab} trackState={trackState?.text} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
          <LaneLabels type="video" lanes={tracks.video} laneLabels={laneLabels?.video} expanded={expandedTracks.video} onExpand={() => onTrackExpand('video')} activeTab={activeTab} trackState={trackState?.video} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
          <LaneLabels type="audio" lanes={tracks.audio} laneLabels={laneLabels?.audio} expanded={expandedTracks.audio} onExpand={() => onTrackExpand('audio')} onAddClip={onAddAudioClip} activeTab={activeTab} trackState={trackState?.audio} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
        </div>
        <div
          className="st-track-surface"
          ref={trackSurfaceRef}
          onScroll={handleSurfaceScroll}
          onMouseMove={handleSurfaceMouseMove}
          onMouseLeave={handleSurfaceMouseLeave}
          onDragOver={handleMediaDragOver}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropGhost(null); }}
          onDrop={handleMediaDrop}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek(Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft) / pxPerSecond));
          }}
        >
          <div className="st-playhead" style={{ left: playheadLeft }} onMouseDown={onPlayheadDragStart} />
          {dropGhost && (dropGhost.newLane ? (
            <div className="st-drop-newlane" style={{ top: dropGhost.top }}><span>New track above</span></div>
          ) : (
            <div className={`st-drop-ghost is-${dropGhost.kind}`} style={{ left: dropGhost.left, top: dropGhost.top, width: dropGhost.width, height: dropGhost.height }}>
              <span>{dropGhost.label}</span>
            </div>
          ))}
          {activeTab === 'editor' && markers?.map((marker) => (
            <MarkerTick key={marker.id} marker={marker} pxPerSecond={pxPerSecond} onJump={onJumpToMarker} onRemove={onRemoveMarker} />
          ))}
          <LaneRows type="text" lanes={tracks.text} expanded={expandedTracks.text} placeholder="Add text or captions" trackState={trackState?.text} onPlaceholderClick={onAddTextClip} onGapContextMenu={onGapContextMenu} {...laneListProps} />
          <LaneRows type="video" lanes={tracks.video} expanded={expandedTracks.video} placeholder={activeTab === 'editor' ? 'Import media or drag it here' : 'Drop clips here'} trackState={trackState?.video} onGapContextMenu={onGapContextMenu} {...laneListProps} />
          <LaneRows type="audio" lanes={tracks.audio} expanded={expandedTracks.audio} placeholder="Add music" trackState={trackState?.audio} onPlaceholderClick={onAddAudioClip} onGapContextMenu={onGapContextMenu} {...laneListProps} />
        </div>
      </div>
      <HoverScrubPreview preview={hoverPreview} />
    </section>
  );
}

export default BottomTimeline;

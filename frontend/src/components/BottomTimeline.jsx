import { useRef, useState } from 'react';

// Pixels-per-second at 100% zoom - shared with App.jsx's drag/trim math
// (imported there) so screen deltas and stored time deltas agree.
export const PX_PER_SECOND = 24;

function formatTime(seconds) {
  const safe = Number(seconds) || 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function getRulerConfig(totalDuration, zoom) {
  const safe = Math.max(Number(totalDuration) || 0, 10);
  const targetMarkerCount = Math.max(4, Math.min(30, Math.round(12 * (zoom / 100))));
  const rawInterval = safe / targetMarkerCount;
  const niceIntervals = [1, 2, 5, 10, 15, 30, 60, 120, 180, 300, 600];
  let step = niceIntervals[niceIntervals.length - 1];
  for (const ni of niceIntervals) {
    if (ni >= rawInterval) {
      step = ni;
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
  return { step, markers, max: safe };
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

// Exported so App.jsx's drag handler can hit-test a vertical drag delta
// against the same row height used here.
export const LANE_ROW_HEIGHT = 44;
const LANE_ROW_HEIGHT_EXPANDED = 72;
const ADD_TRACK_ROW_HEIGHT = 28;

// Height of a lane's row, kept identical between the label column and the
// track-surface column so the two side-by-side lists stay aligned.
function laneHeight(expanded) {
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
        {onAddClip && <button type="button" className="track-action" title={`Add ${type}`} onClick={onAddClip}>+</button>}
        {onMoveUp && <button type="button" className="track-action" title="Move track up" disabled={!canMoveUp} onClick={onMoveUp}>↑</button>}
        {onMoveDown && <button type="button" className="track-action" title="Move track down" disabled={!canMoveDown} onClick={onMoveDown}>↓</button>}
        <button type="button" className={`track-action ${hidden ? 'is-active' : ''}`} title={type === 'audio' ? 'Mute track' : 'Hide track'} onClick={onToggleHidden}><span className="track-dot"/></button>
        <button type="button" className={`track-action ${locked ? 'is-active' : ''}`} title="Lock track" onClick={onToggleLock}><span className="track-lock">⌑</span></button>
        {onRemove && <button type="button" className="track-action" title="Remove track" disabled={!canRemove} onClick={onRemove}>✕</button>}
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

function ClipBlock({ clip, pxPerSecond, isSelected, isMultiSelected, locked, onSelect, onDragStart, onTrimStart, onTrimEnd }) {
  const left = clip.startTime * pxPerSecond;
  const width = Math.max(40, clip.duration * pxPerSecond);
  return (
    <div
      className={`timeline-clip timeline-clip-${clip.type} ${isSelected ? 'timeline-clip-selected' : ''} ${isMultiSelected ? 'timeline-clip-multi-selected' : ''} ${locked ? 'timeline-clip-locked' : ''} ${clip.enabled === false ? 'timeline-clip-disabled' : ''} ${clip.groupId ? 'timeline-clip-grouped' : ''}`}
      style={{ position: 'absolute', left: `${left}px`, width: `${width}px`, top: 0, bottom: 0 }}
      title={[clip.label, clip.enabled === false && '(disabled)', clip.reversed && '(reversed)', clip.frozen && '(frozen)'].filter(Boolean).join(' ')}
      onClick={(e) => { e.stopPropagation(); onSelect?.(clip.id, e); }}
      onMouseDown={(e) => { if (!locked) onDragStart?.(e, clip.id); }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <span className="timeline-clip-handle timeline-clip-handle-left" onMouseDown={(e) => { e.stopPropagation(); if (!locked) onTrimStart?.(e, clip.id, 'left'); }} />
      {clip.type === 'audio' && <span className="timeline-waveform">▂▅▃▆▄▇▃▅</span>}
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
        <button type="button" className="timeline-placeholder timeline-placeholder-button" onClick={onPlaceholderClick} style={{ position: 'absolute', left: 0, top: 0, bottom: 0 }}>
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
  const ruler = getRulerConfig(totalDuration, zoom);
  const duration = ruler.max;
  const pxPerSecond = PX_PER_SECOND * (zoom / 100);
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
  const handleSurfaceScroll = (e) => {
    if (labelsRef.current) labelsRef.current.scrollTop = e.currentTarget.scrollTop;
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
      <div className="timeline-ruler">
        <div className="timeline-ruler-offset"><span>{laneCount} tracks · {formatTime(duration)}</span></div>
        <div className="timeline-ruler-markers">{ruler.markers.map((marker)=><span key={marker}>{formatTime(marker)}</span>)}</div>
      </div>
      <div className="timeline-tracks">
        <div className="timeline-track-labels" ref={labelsRef}>
          <LaneLabels type="text" lanes={tracks.text} laneLabels={laneLabels?.text} expanded={expandedTracks.text} onExpand={() => onTrackExpand('text')} onAddClip={onAddTextClip} onAddTrack={onAddTrack} activeTab={activeTab} trackState={trackState?.text} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
          <LaneLabels type="video" lanes={tracks.video} laneLabels={laneLabels?.video} expanded={expandedTracks.video} onExpand={() => onTrackExpand('video')} onAddTrack={onAddTrack} activeTab={activeTab} trackState={trackState?.video} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
          <LaneLabels type="audio" lanes={tracks.audio} laneLabels={laneLabels?.audio} expanded={expandedTracks.audio} onExpand={() => onTrackExpand('audio')} onAddClip={onAddAudioClip} onAddTrack={onAddTrack} activeTab={activeTab} trackState={trackState?.audio} onToggleLock={onToggleLock} onToggleHidden={onToggleHidden} onRemoveTrack={onRemoveTrack} onRenameTrack={onRenameTrack} onReorderTrack={onReorderTrack} />
        </div>
        <div
          className="timeline-track-surface"
          onScroll={handleSurfaceScroll}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek(Math.max(0, (e.clientX - rect.left) / pxPerSecond));
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
    </section>
  );
}

export default BottomTimeline;

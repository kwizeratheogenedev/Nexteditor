import { useEffect, useRef, useState } from 'react';

const TYPE_COLOR = {
  video: '#3b82f6',
  audio: '#22c55e',
  text: '#f59e0b',
  adjustment: '#ec4899',
};

// Zoomed-out overview of the whole timeline with a draggable viewport window
// synced to the main track-surface's scroll position - lets a long project
// be navigated without hunting through the fully-zoomed-in timeline. Reuses
// the same lane-color convention as ClipBlock, just without per-clip
// thumbnails/waveforms at this scale (not useful at a few pixels wide).
function TimelineMinimap({ tracks, duration, totalWidth, trackSurfaceRef }) {
  const minimapRef = useRef(null);
  const [viewport, setViewport] = useState({ left: 0, width: 100 });
  const draggingRef = useRef(false);

  const syncViewport = () => {
    const surface = trackSurfaceRef.current;
    const minimap = minimapRef.current;
    if (!surface || !minimap || !totalWidth) return;
    const minimapWidth = minimap.clientWidth;
    setViewport({
      left: (surface.scrollLeft / totalWidth) * minimapWidth,
      width: Math.max(4, (surface.clientWidth / totalWidth) * minimapWidth),
    });
  };

  useEffect(() => {
    syncViewport();
    const surface = trackSurfaceRef.current;
    if (!surface) return undefined;
    surface.addEventListener('scroll', syncViewport);
    return () => surface.removeEventListener('scroll', syncViewport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalWidth, trackSurfaceRef]);

  const scrollToClientX = (clientX) => {
    const surface = trackSurfaceRef.current;
    const minimap = minimapRef.current;
    if (!surface || !minimap) return;
    const rect = minimap.getBoundingClientRect();
    const minimapWidth = rect.width;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / minimapWidth));
    // Centers the viewport on the clicked/dragged point rather than jumping
    // its left edge there, which feels more natural when dragging.
    surface.scrollLeft = Math.max(0, fraction * totalWidth - surface.clientWidth / 2);
  };

  const handleMouseDown = (e) => {
    draggingRef.current = true;
    scrollToClientX(e.clientX);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (draggingRef.current) scrollToClientX(e.clientX);
    };
    const handleMouseUp = () => { draggingRef.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalWidth]);

  const allClips = [
    ...tracks.video.flat().map((c) => ({ ...c, color: TYPE_COLOR[c.type] || TYPE_COLOR.video })),
    ...tracks.audio.flat().map((c) => ({ ...c, color: TYPE_COLOR.audio })),
    ...tracks.text.flat().map((c) => ({ ...c, color: TYPE_COLOR.text })),
  ];

  return (
    <div className="timeline-minimap" ref={minimapRef} onMouseDown={handleMouseDown}>
      {allClips.map((clip) => (
        <div
          key={clip.id}
          className="timeline-minimap-clip"
          style={{
            left: `${(clip.startTime / duration) * 100}%`,
            width: `${Math.max(0.3, (clip.duration / duration) * 100)}%`,
            background: clip.color,
          }}
        />
      ))}
      <div
        className="timeline-minimap-viewport"
        style={{ left: `${viewport.left}px`, width: `${viewport.width}px` }}
      />
    </div>
  );
}

export default TimelineMinimap;

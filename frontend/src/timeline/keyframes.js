// Linear keyframe interpolation shared by the canvas preview
// (useTimelinePlayer) and the RightPanel's keyframe editing UI. `points` is
// an array of {t, value} in clip-local output time (0 = the clip's first
// visible frame). Held constant before the first / after the last keyframe.
export function resolveKeyframedValue(points, localTime, fallback) {
  if (!points || points.length === 0) return fallback;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  if (localTime <= sorted[0].t) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (localTime >= last.t) return last.value;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    if (localTime >= p0.t && localTime <= p1.t) {
      const span = p1.t - p0.t;
      const ratio = span > 0 ? (localTime - p0.t) / span : 0;
      return p0.value + (p1.value - p0.value) * ratio;
    }
  }
  return fallback;
}

// Adds a keyframe at `t`, replacing one that's already within `epsilon` of
// that time (so nudging the same spot doesn't pile up near-duplicates).
export function upsertKeyframe(points, t, value, epsilon = 0.05) {
  const list = points ? [...points] : [];
  const idx = list.findIndex((p) => Math.abs(p.t - t) < epsilon);
  if (idx >= 0) {
    list[idx] = { t: list[idx].t, value };
  } else {
    list.push({ t, value });
  }
  return list.sort((a, b) => a.t - b.t);
}

export function removeKeyframeNear(points, t, epsilon = 0.05) {
  if (!points) return points;
  return points.filter((p) => Math.abs(p.t - t) >= epsilon);
}

export function findKeyframeNear(points, t, epsilon = 0.05) {
  if (!points) return null;
  return points.find((p) => Math.abs(p.t - t) < epsilon) || null;
}

// Since M7 every clip carries its own absolute startTime, so "where does
// this clip start" is a direct lookup for any clip type (video/audio/text) -
// no more per-type accumulation math. Kept as a timeline-lookup (not just
// `clip.startTime`) so callers with only a clipId (RightPanel) don't need to
// separately hold onto the clip object.
export function getClipStartTime(timeline, clipId) {
  return timeline.find((clip) => clip.id === clipId)?.startTime ?? 0;
}

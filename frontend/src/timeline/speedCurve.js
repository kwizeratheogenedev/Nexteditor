// A clip's speed curve (clip.keyframes.speed) is a set of {t, value} points
// in SOURCE-local time (0 = trimmedStart) that step the playback speed -
// each point's value holds constant until the next point, rather than
// linearly ramping between them. This is a deliberate simplification: a
// truly continuous speed ramp needs ffmpeg's setpts to integrate a
// time-varying rate, which was empirically found to drop every frame
// (PREV_OUTPTS-based cumulative expressions aren't a reliable technique -
// see M12 notes). A stepped curve instead reuses the same trim+setpts
// building blocks every flat-speed clip already uses, just once per
// segment, concatenated - verified empirically against the bundled ffmpeg
// before wiring in (see backend/services/filterGraph/effects/speedCurve.js).
//
// Mirrored exactly in backend/services/filterGraph/effects/speedCurve.js so
// the preview and the export agree on segment boundaries/duration.

export function hasSpeedCurve(clip) {
  return Array.isArray(clip.keyframes?.speed) && clip.keyframes.speed.length > 0;
}

// Segments covering [0, sourceSpan) of the clip's OWN trimmed range, each
// with the speed that applies for its duration. Falls back to a single
// segment at the clip's flat `speed` when there's no curve (0 or 1 points).
export function buildSpeedSegments(clip) {
  const span = Math.max(0, clip.trimmedEnd - clip.trimmedStart);
  if (!hasSpeedCurve(clip)) {
    return [{ sourceStart: 0, sourceEnd: span, speed: clip.speed || 1 }];
  }
  const points = [...clip.keyframes.speed].sort((a, b) => a.t - b.t);
  const segments = [];
  for (let i = 0; i < points.length; i += 1) {
    const start = i === 0 ? 0 : points[i].t;
    const end = i === points.length - 1 ? span : points[i + 1].t;
    const clampedStart = Math.max(0, Math.min(start, span));
    const clampedEnd = Math.max(0, Math.min(end, span));
    if (clampedEnd > clampedStart) {
      segments.push({ sourceStart: clampedStart, sourceEnd: clampedEnd, speed: points[i].value || 1 });
    }
  }
  return segments.length ? segments : [{ sourceStart: 0, sourceEnd: span, speed: clip.speed || 1 }];
}

// Total OUTPUT duration across every segment - replaces the flat
// `(trimmedEnd-trimmedStart)/speed` formula for a curved clip.
export function speedCurveOutputDuration(clip) {
  return buildSpeedSegments(clip).reduce((sum, seg) => sum + (seg.sourceEnd - seg.sourceStart) / (seg.speed || 1), 0);
}

// Maps an amount of elapsed OUTPUT time (0 = the clip's first visible
// frame) to the corresponding SOURCE-local time (0 = trimmedStart) by
// walking segments in order - the preview's per-frame seek target.
// The speed value active at a given amount of elapsed OUTPUT time - what
// RightPanel's Speed slider should display while scrubbing a curved clip.
export function currentSegmentSpeed(clip, outputElapsed) {
  const segments = buildSpeedSegments(clip);
  const sourceT = sourceTimeForOutputElapsed(clip, outputElapsed);
  const found = segments.find((seg) => sourceT >= seg.sourceStart && sourceT < seg.sourceEnd) || segments[segments.length - 1];
  return found?.speed || 1;
}

export function sourceTimeForOutputElapsed(clip, outputElapsed) {
  const segments = buildSpeedSegments(clip);
  let acc = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const segOutputDuration = (seg.sourceEnd - seg.sourceStart) / (seg.speed || 1);
    const isLast = i === segments.length - 1;
    if (outputElapsed <= acc + segOutputDuration || isLast) {
      const withinSegOutput = Math.max(0, outputElapsed - acc);
      return Math.min(seg.sourceEnd, seg.sourceStart + withinSegOutput * (seg.speed || 1));
    }
    acc += segOutputDuration;
  }
  return 0;
}

import { atempoFactors } from './speed.js';

// Mirrors frontend/src/timeline/speedCurve.js exactly - a clip's speed
// curve (clip.keyframes.speed) is a set of {t, value} points in
// SOURCE-local time (0 = trimmedStart) that STEP the playback speed rather
// than interpolate it. A continuous ramp would need ffmpeg's setpts to
// integrate a time-varying rate; a PREV_OUTPTS-based cumulative expression
// was tried and empirically dropped every frame, so instead each stepped
// segment gets its own ordinary trim+setpts (the same technique every
// flat-speed clip already uses), concatenated into one stream - verified
// empirically against the bundled ffmpeg before wiring in.

export function hasSpeedCurve(clip) {
  return Array.isArray(clip.keyframes?.speed) && clip.keyframes.speed.length > 0;
}

function buildSegments(clip) {
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

export function speedCurveOutputDuration(clip) {
  return buildSegments(clip).reduce((sum, seg) => sum + (seg.sourceEnd - seg.sourceStart) / (seg.speed || 1), 0);
}

// Single source of truth for a clip's own output duration, replacing the
// `(trimmedEnd-trimmedStart)/speed` formula that used to be duplicated
// across index.js/exportTimeline.js - accounts for a speed curve when
// present, same floor as those call sites already used.
export function clipOutputDuration(clip) {
  const duration = hasSpeedCurve(clip)
    ? speedCurveOutputDuration(clip)
    : (clip.trimmedEnd - clip.trimmedStart) / (clip.speed || 1);
  return Math.max(0.05, duration);
}

// Builds one continuous video stream from a clip's stepped speed segments -
// each segment is independently trimmed+re-timed (setpts=PTS/speed, same
// math as a flat-speed clip's applyVideoSpeed), then concatenated.
// Transform/color/vignette apply once to the result afterward, same as any
// other clip - callers swap this in for applyVideoTrim+applyVideoSpeed.
export function applyVideoSpeedCurve(graph, inputLabel, clip) {
  const segments = buildSegments(clip);
  const labels = segments.map((seg) => {
    const out = graph.label('vseg');
    graph.addNode(
      `trim=start=${clip.trimmedStart + seg.sourceStart}:end=${clip.trimmedStart + seg.sourceEnd},setpts=(PTS-STARTPTS)/${seg.speed || 1}`,
      inputLabel, out,
    );
    return out;
  });
  if (labels.length === 1) return labels[0];
  const out = graph.label('vspeedcurve');
  graph.addNode(`concat=n=${labels.length}:v=1:a=0`, labels, out);
  return out;
}

export function applyAudioSpeedCurve(graph, inputLabel, clip) {
  const segments = buildSegments(clip);
  const labels = segments.map((seg) => {
    const out = graph.label('aseg');
    const speed = seg.speed || 1;
    const speedChain = Math.abs(speed - 1) < 0.001
      ? 'anull'
      : atempoFactors(speed).map((f) => `atempo=${f.toFixed(4)}`).join(',');
    graph.addNode(
      `atrim=start=${clip.trimmedStart + seg.sourceStart}:end=${clip.trimmedStart + seg.sourceEnd},asetpts=PTS-STARTPTS,${speedChain}`,
      inputLabel, out,
    );
    return out;
  });
  if (labels.length === 1) return labels[0];
  const out = graph.label('aspeedcurve');
  graph.addNode(`concat=n=${labels.length}:v=0:a=1`, labels, out);
  return out;
}

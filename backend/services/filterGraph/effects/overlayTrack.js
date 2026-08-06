import { applyVideoTrim } from './trim.js';
import { applyVideoSpeed } from './speed.js';
import { applyVideoTransform } from './transform.js';
import { applyVideoColor } from './color.js';
import { applyVignette } from './vignette.js';
import { hasSpeedCurve, applyVideoSpeedCurve } from './speedCurve.js';

// Builds one overlay-lane (trackIndex 1+) clip's fully processed frame -
// same trim/speed/transform/color/vignette pipeline as a lane-0 clip, but
// applyVideoTransform composites it onto a *transparent* canvas instead of
// black (see transform.js's `transparent` option, empirically verified:
// `color=black@0.0` + `overlay=format=auto` leaves everything outside the
// clip's own footprint transparent). Not yet positioned in time - that's
// compositeOverlayClip below.
export function buildOverlayClip(graph, inputLabel, clip, canvas, outputDuration) {
  let video = hasSpeedCurve(clip)
    ? applyVideoSpeedCurve(graph, inputLabel, clip)
    : applyVideoSpeed(graph, applyVideoTrim(graph, inputLabel, clip), clip);
  video = applyVideoTransform(graph, video, clip, canvas, outputDuration, { transparent: true });
  video = applyVideoColor(graph, video, clip);
  video = applyVignette(graph, video, clip);
  return video;
}

// Layers one overlay clip's transparent-background frame onto the growing
// program at its own absolute [startTime, endTime) window - since the
// clip's own content already carries full opacity and everything else in
// its frame is transparent (buildOverlayClip above), this single
// `overlay=enable=` call is all that's needed; the program shows through
// everywhere the overlay clip doesn't paint, both outside its footprint and
// outside its active time window.
export function compositeOverlayClip(graph, programLabel, overlayLabel, startTime, endTime) {
  const out = graph.label('overlaid');
  graph.addNode(`overlay=enable='between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})':format=auto`, [programLabel, overlayLabel], out);
  return out;
}

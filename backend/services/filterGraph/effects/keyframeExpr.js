// Builds an ffmpeg per-frame expression that linearly interpolates between
// sorted keyframe points, holding the edge values outside the keyframe
// range. Mirrors the interpolation math in frontend/src/timeline/keyframes.js
// so exported video matches the preview. `timeVar` is the filter's own time
// variable name - most filters (rotate, overlay) use lowercase `t`, but geq
// uses uppercase `T`.
export function buildKeyframeExpr(points, timeVar = 't') {
  if (!points || points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  if (sorted.length === 1) return String(sorted[0].value);

  let expr = String(sorted[sorted.length - 1].value);
  for (let i = sorted.length - 2; i >= 0; i -= 1) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    const span = p1.t - p0.t;
    const interp = span > 0
      ? `(${p0.value}+(${p1.value}-${p0.value})*(${timeVar}-${p0.t})/${span})`
      : String(p1.value);
    expr = `if(lt(${timeVar},${p1.t}),${interp},${expr})`;
  }
  return `if(lt(${timeVar},${sorted[0].t}),${sorted[0].value},${expr})`;
}

export function hasKeyframes(keyframes, property) {
  return Array.isArray(keyframes?.[property]) && keyframes[property].length > 0;
}

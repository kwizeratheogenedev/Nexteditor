import { buildKeyframeExpr, hasKeyframes } from './keyframeExpr.js';

// Applies the clip's Basic-tab transform (scale/rotation/flip/position/
// opacity), animated via keyframes when present. A clip with no meaningful
// adjustment beyond a possible flip takes a cheap "fit to canvas" path (the
// same scale+pad pattern already used elsewhere in this codebase); a clip
// with position/opacity/rotation changes (static or keyframed) is
// composited onto a canvas-sized background so those adjustments are
// visible even without another layer to place it against. Scale isn't
// keyframeable yet - see the note in
// frontend/src/hooks/usePersistedEditorState.js normalizeClip.
//
// `transparent: true` (overlay-lane clips, M8) uses a fully transparent
// background instead of black and always goes through the full
// compositing path (skipping the cheap fit shortcut, which has no alpha
// channel) - empirically verified that `color=black@0.0` + `overlay=
// format=auto` correctly leaves everything outside the clip's own
// footprint transparent, so overlaying *this* result onto the growing
// program (in effects/overlayTrack.js) only shows the actual clip pixels,
// letting lane 0 show through everywhere else.
export function applyVideoTransform(graph, inputLabel, clip, canvas, outputDuration, { transparent = false } = {}) {
  const t = clip.transform || {};
  const kf = clip.keyframes || {};
  const scaleX = typeof t.scaleX === 'number' ? t.scaleX : 1;
  const scaleY = typeof t.scaleY === 'number' ? t.scaleY : 1;
  const rotation = t.rotation || 0;
  const opacity = typeof t.opacity === 'number' ? t.opacity : 1;
  const posX = t.x || 0;
  const posY = t.y || 0;

  const rotationKeyframed = hasKeyframes(kf, 'rotation');
  const opacityKeyframed = hasKeyframes(kf, 'opacity');
  const xKeyframed = hasKeyframes(kf, 'x');
  const yKeyframed = hasKeyframes(kf, 'y');

  const hasFlip = scaleX < 0 || scaleY < 0;
  const hasScale = Math.abs(Math.abs(scaleX) - 1) > 0.001 || Math.abs(Math.abs(scaleY) - 1) > 0.001;
  const hasRotation = rotationKeyframed || Math.abs(rotation) > 0.01;
  const hasOpacity = opacityKeyframed || opacity < 0.999;
  const hasPosition = xKeyframed || yKeyframed || Math.abs(posX) > 0.01 || Math.abs(posY) > 0.01;

  let current = inputLabel;
  if (hasFlip) {
    const flipFilters = [];
    if (scaleX < 0) flipFilters.push('hflip');
    if (scaleY < 0) flipFilters.push('vflip');
    const out = graph.label('flip');
    graph.addNode(flipFilters.join(','), current, out);
    current = out;
  }

  if (!transparent && !hasScale && !hasRotation && !hasOpacity && !hasPosition) {
    const out = graph.label('fit');
    graph.addNode(
      `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease,pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
      current,
      out,
    );
    return out;
  }

  const magnitude = Math.max(0.05, Math.min(4, Math.abs(scaleX) || 1));
  const scaledW = Math.max(2, Math.round(canvas.width * magnitude));
  const scaledH = Math.max(2, Math.round(canvas.height * magnitude));
  const scaleOut = graph.label('scale');
  graph.addNode(`scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease`, current, scaleOut);
  current = scaleOut;

  if (hasRotation) {
    const rotateOut = graph.label('rotate');
    // rotate's angle= is a native per-frame expression (verified against the
    // bundled ffmpeg build), so a keyframed angle is just degrees-to-radians
    // wrapped around the same interpolation expression used everywhere else.
    const angleExpr = rotationKeyframed
      ? `(${buildKeyframeExpr(kf.rotation)})*PI/180`
      : String((rotation * Math.PI) / 180);
    graph.addNode(`rotate=a='${angleExpr}':c=black`, current, rotateOut);
    current = rotateOut;
  }

  if (hasOpacity) {
    const opacityOut = graph.label('opacity');
    if (opacityKeyframed) {
      // colorchannelmixer's aa= option does not accept per-frame
      // expressions (verified against the bundled ffmpeg build - it only
      // takes a static number), so keyframed opacity goes through geq
      // instead, which does support a per-pixel/per-frame alpha expression
      // (using geq's own uppercase T time variable).
      const alphaExpr = buildKeyframeExpr(kf.opacity, 'T');
      graph.addNode(
        `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='(${alphaExpr})*255'`,
        current,
        opacityOut,
      );
    } else {
      const clampedOpacity = Math.max(0, Math.min(1, opacity));
      graph.addNode(`format=rgba,colorchannelmixer=aa=${clampedOpacity.toFixed(3)}`, current, opacityOut);
    }
    current = opacityOut;
  }

  const bgLabel = graph.label('bg');
  // The non-transparent (lane 0) path is unchanged from before M8; only the
  // transparent overlay-lane path adds the explicit rgba format so its
  // alpha=0 background actually carries through.
  const bgSpec = transparent
    ? `color=c=black@0.0:s=${canvas.width}x${canvas.height}:r=${canvas.fps}:d=${outputDuration},format=rgba`
    : `color=c=black:s=${canvas.width}x${canvas.height}:r=${canvas.fps}:d=${outputDuration}`;
  graph.addNode(bgSpec, [], bgLabel);
  const overlayOut = graph.label('composited');
  const xExpr = xKeyframed ? buildKeyframeExpr(kf.x) : String(Math.round(posX));
  const yExpr = yKeyframed ? buildKeyframeExpr(kf.y) : String(Math.round(posY));
  graph.addNode(
    `overlay=x='(W-w)/2+${xExpr}':y='(H-h)/2+${yExpr}':format=auto,setsar=1`,
    [bgLabel, current],
    overlayOut,
  );
  return overlayOut;
}

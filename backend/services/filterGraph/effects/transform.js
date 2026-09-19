import { buildKeyframeExpr, hasKeyframes } from './keyframeExpr.js';
import { applyChromaKey } from './chromaKey.js';

// Applies the clip's Basic-tab transform (scale/rotation/flip/position/
// opacity), animated via keyframes when present. A clip with no meaningful
// adjustment beyond a possible flip takes a cheap "fit to canvas" path (the
// same scale+pad pattern already used elsewhere in this codebase); a clip
// with scale/position/opacity/rotation changes (static or keyframed) is
// composited onto a canvas-sized background so those adjustments are
// visible even without another layer to place it against.
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
  const scaleXKeyframed = hasKeyframes(kf, 'scaleX');
  const scaleYKeyframed = hasKeyframes(kf, 'scaleY');
  const scaleKeyframed = scaleXKeyframed || scaleYKeyframed;

  const hasFlip = scaleX < 0 || scaleY < 0;
  const hasScale = scaleKeyframed
    || Math.abs(Math.abs(scaleX) - 1) > 0.001
    || Math.abs(Math.abs(scaleY) - 1) > 0.001;
  const hasRotation = rotationKeyframed || Math.abs(rotation) > 0.01;
  const hasOpacity = opacityKeyframed || opacity < 0.999;
  const hasPosition = xKeyframed || yKeyframed || Math.abs(posX) > 0.01 || Math.abs(posY) > 0.01;
  const hasChromaKey = Boolean((clip.filters || []).find((f) => f.type === 'chromaKey' && f.enabled !== false));

  let current = inputLabel;
  // Applied first, before flip/scale/rotate, so the alpha it produces
  // survives the rest of this chain and resolves against the real
  // background at the end (opaque black for lane 0 - nothing behind a
  // keyed-out pixel to show - or the transparent overlay background for
  // lane 1+, letting the lane below show through: the actual green-screen
  // use case). This is also why chroma key always forces the full
  // compositing path below instead of the cheap fit shortcut, which has no
  // alpha channel to resolve into.
  if (hasChromaKey) {
    current = applyChromaKey(graph, current, clip);
  }
  if (hasFlip) {
    const flipFilters = [];
    if (scaleX < 0) flipFilters.push('hflip');
    if (scaleY < 0) flipFilters.push('vflip');
    const out = graph.label('flip');
    graph.addNode(flipFilters.join(','), current, out);
    current = out;
  }

  // fitMode 'cover' crops to fill the target box (no black bars) instead of
  // 'contain'-style letterbox/pillarbox padding - see canvasPresets.js's
  // defaultFitModeFor (any non-16:9 canvas defaults to cover, matching
  // CapCut's own vertical-reformat default and this repo's existing
  // extractShorts.js/reformatShort.js precedent for the same crop pattern).
  const isCover = canvas.fitMode === 'cover';

  if (!transparent && !hasScale && !hasRotation && !hasOpacity && !hasPosition && !hasChromaKey) {
    const out = graph.label('fit');
    const fitFilter = isCover
      ? `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=increase,crop=${canvas.width}:${canvas.height},setsar=1`
      : `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease,pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    graph.addNode(fitFilter, current, out);
    return out;
  }

  const scaleOut = graph.label('scale');
  if (scaleKeyframed) {
    // Keyframed scale (the Ken Burns / pan-zoom case - see the Animate
    // presets in frontend/src/components/RightPanel.jsx) can't use the
    // fixed scale+crop pair below, because the target size now changes on
    // every frame. `scale` supports exactly that through `eval=frame`,
    // which re-evaluates its w/h expressions per frame using the filter's
    // own `t` (clip-local, since trim/setpts already rebased this stream to
    // 0) - empirically verified against the bundled ffmpeg, including that
    // the following `overlay` happily takes a second input whose size
    // changes frame to frame. zoompan was tried first and dropped: it
    // silently discards the alpha channel, which would have turned every
    // animated overlay-lane clip into an opaque black box over the program.
    //
    // The expression is the export-side mirror of the preview's own
    // `drawW = vw * fitScale * scaleX` (see drawVideoEntry in
    // frontend/src/timeline/useTimelinePlayer.js): `fit` is that same
    // contain/cover fit factor, expressed in ffmpeg's iw/ih terms so it
    // adapts to whatever the real source dimensions turn out to be, and the
    // result is rounded down to an even size (odd dimensions break chroma
    // subsampling on the encode). No `force_original_aspect_ratio`/`crop`
    // here: w and h are computed exactly, and anything spilling past the
    // canvas is clipped by the overlay onto the canvas-sized background
    // below - the same thing the static path's crop does.
    const fit = isCover
      ? `max(${canvas.width}/iw,${canvas.height}/ih)`
      : `min(${canvas.width}/iw,${canvas.height}/ih)`;
    const staticMagnitudeX = Math.max(0.05, Math.min(4, Math.abs(scaleX) || 1));
    const staticMagnitudeY = Math.max(0.05, Math.min(4, Math.abs(scaleY) || 1));
    // A clip can animate one axis and hold the other static - matching the
    // preview, which resolves scaleX and scaleY independently.
    const sxExpr = scaleXKeyframed ? `abs(${buildKeyframeExpr(kf.scaleX)})` : String(staticMagnitudeX);
    const syExpr = scaleYKeyframed ? `abs(${buildKeyframeExpr(kf.scaleY)})` : String(staticMagnitudeY);
    const evenExpr = (dimension, fitFactor, magnitudeExpr) => `max(2,trunc(${dimension}*${fitFactor}*(${magnitudeExpr})/2)*2)`;
    graph.addNode(
      `scale=w='${evenExpr('iw', fit, sxExpr)}':h='${evenExpr('ih', fit, syExpr)}':eval=frame`,
      current,
      scaleOut,
    );
  } else {
    const magnitude = Math.max(0.05, Math.min(4, Math.abs(scaleX) || 1));
    const scaledW = Math.max(2, Math.round(canvas.width * magnitude));
    const scaledH = Math.max(2, Math.round(canvas.height * magnitude));
    const scaleFilter = isCover
      ? `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH}`
      : `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease`;
    graph.addNode(scaleFilter, current, scaleOut);
  }
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
  // posX/posY are a percent of half the canvas dimension (0=center,
  // +/-100=edge of frame, schema v4+) - must stay identical to the preview
  // formula in frontend/src/timeline/useTimelinePlayer.js's drawVideoEntry
  // (ctx.translate call), or a positioned/keyframed overlay would land in a
  // different spot in the exported file than what the user saw while editing.
  const xExpr = xKeyframed
    ? `(${buildKeyframeExpr(kf.x)})*${canvas.width}/200`
    : String(Math.round((posX * canvas.width) / 200));
  const yExpr = yKeyframed
    ? `(${buildKeyframeExpr(kf.y)})*${canvas.height}/200`
    : String(Math.round((posY * canvas.height) / 200));
  graph.addNode(
    `overlay=x='(W-w)/2+${xExpr}':y='(H-h)/2+${yExpr}':format=auto,setsar=1`,
    [bgLabel, current],
    overlayOut,
  );
  return overlayOut;
}

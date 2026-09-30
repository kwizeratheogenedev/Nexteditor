import { resolveKeyframedValue } from './keyframes';
import { resolveActiveInLane, clipDuration } from './transitions';
import { hasSpeedCurve, sourceTimeForOutputElapsed } from './speedCurve';
import { drawCaption } from './captionStyles';

// Everything that decides what one frame of the editor timeline looks like,
// shared by the live preview (timeline/useTimelinePlayer.js) and the
// on-device export (editor/localExport/) so the exported file matches the
// preview. Neither caller's way of getting video frames lives here: they
// pass `getSource(entry)` - the preview answers from pooled <video>
// elements, the export from exactly decoded frames.

// Groups a media type's clips by trackIndex into lanes, sorted ascending -
// for video this ordering IS the z-order (lane 0 = background, drawn
// first; higher lanes layer on top, matching CapCut's "track above sits in
// front"). For audio/text there's no z-order meaning, but a stable
// iteration order is still convenient.
export function groupLanes(clips) {
  const byIndex = new Map();
  clips.forEach((clip) => {
    const idx = clip.trackIndex || 0;
    if (!byIndex.has(idx)) byIndex.set(idx, []);
    byIndex.get(idx).push(clip);
  });
  return [...byIndex.keys()].sort((a, b) => a - b).map((idx) => byIndex.get(idx));
}

// Approximates the clip's 'color' filter (brightness/contrast/saturation)
// using Canvas2D's native ctx.filter, so the preview doesn't need its own
// pixel-processing code - kept in one place since both this compositor and
// (eventually) any other canvas consumer need the exact same mapping the
// backend's eq= filter uses in backend/services/filterGraph/effects/color.js.
export function cssFilterForClip(clip) {
  const colorFilter = (clip.filters || []).find((filter) => filter.type === 'color' && filter.enabled !== false);
  if (!colorFilter) return 'none';
  const { brightness = 0, contrast = 0, saturation = 0 } = colorFilter.params || {};
  const b = Math.max(0, 1 + brightness / 100);
  const c = Math.max(0, 1 + contrast / 100);
  const s = Math.max(0, 1 + saturation / 100);
  // Temperature has no Canvas2D filter equivalent - see applyTemperature,
  // which the export uses (the live preview skips it to stay fast).
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

function temperatureOf(clip) {
  const colorFilter = (clip.filters || []).find((filter) => filter.type === 'color' && filter.enabled !== false);
  return Number(colorFilter?.params?.temperature) || 0;
}

// The server's temperature, colorbalance=rs=shift:bs=-shift, per pixel:
// ffmpeg's colorbalance weights a "shadows" shift by how dark the pixel is.
export function applyTemperature(ctx, width, height, temperature) {
  const shift = (Math.max(-100, Math.min(100, temperature)) / 100) * 0.3;
  if (!shift) return;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    const weight = Math.max(0, Math.min(1, (0.333 - lightness) * 4 + 0.5)) * 0.7;
    data[i] = Math.max(0, Math.min(255, (r + shift * weight) * 255));
    data[i + 2] = Math.max(0, Math.min(255, (b - shift * weight) * 255));
  }
  ctx.putImageData(image, 0, 0);
}

// Darkens the frame edges with a radial gradient. Approximates the
// backend's native ffmpeg `vignette` filter (see
// backend/services/filterGraph/effects/vignette.js) closely enough for
// preview purposes - the two aren't pixel-identical (ffmpeg's is a true
// optical/lens-style falloff) but land in the same visual neighborhood.
export function drawVignette(ctx, canvas, intensity) {
  const strength = Math.max(0, Math.min(100, intensity)) / 100;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const outerRadius = Math.sqrt(cx * cx + cy * cy);
  const innerRadius = outerRadius * (1 - strength * 0.6);
  const gradient = ctx.createRadialGradient(cx, cy, Math.max(0, innerRadius * 0.3), cx, cy, outerRadius);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${(0.15 + strength * 0.65).toFixed(3)})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// #rrggbb (with or without '#') -> {r,g,b} 0-255. Never fed untrusted data
// (this only ever reads a value the user picked via <input type="color">),
// so no sanitization needed here unlike the backend's colorkey wiring.
export function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '');
  const num = parseInt(clean.length === 6 ? clean : '00ff00', 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

// Same RGB-distance + linear-feather formula as the backend's ffmpeg
// colorkey= filter (see backend/services/filterGraph/effects/chromaKey.js)
// so the live preview keys out the same pixels the export will: distance is
// a 0-1 normalized Euclidean distance in RGB space, pixels within
// `similarity` of the key color go fully transparent, pixels within
// `similarity + blend` ramp linearly, everything else stays opaque.
export function chromaKeyImageData(imageData, keyColor, similarity, blend) {
  const data = imageData.data;
  const { r: kr, g: kg, b: kb } = keyColor;
  const sqrt3 = Math.sqrt(3);
  for (let i = 0; i < data.length; i += 4) {
    const dr = (data[i] - kr) / 255;
    const dg = (data[i + 1] - kg) / 255;
    const db = (data[i + 2] - kb) / 255;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db) / sqrt3;
    let alpha = 1;
    if (distance <= similarity) alpha = 0;
    else if (blend > 0 && distance <= similarity + blend) alpha = (distance - similarity) / blend;
    data[i + 3] = Math.round(data[i + 3] * alpha);
  }
  return imageData;
}

export function drawTextClip(ctx, clip, canvas) {
  const text = clip.text || {};
  const content = text.content || '';
  if (!content.trim()) return;
  const fontSize = text.fontSize || 64;
  const color = text.color || '#ffffff';
  const align = text.align || 'center';
  const fontFamily = text.fontFamily || 'Inter, sans-serif';
  const lines = content.split('\n');

  ctx.save();
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'bottom';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(2, fontSize * 0.08);

  const x = align === 'left' ? canvas.width * 0.08 : align === 'right' ? canvas.width * 0.92 : canvas.width / 2;
  const baseY = canvas.height * 0.88;

  lines.forEach((line, index) => {
    const lineY = baseY - (lines.length - 1 - index) * (fontSize * 1.2);
    ctx.strokeText(line, x, lineY);
    ctx.fillText(line, x, lineY);
  });
  ctx.restore();
}

// Adapts a plain clip (as returned by transitions.js's resolveActiveInLane)
// into the {clip, localTime, clipStart, duration} shape drawVideoEntry
// wants: `localTime` is where in the *source* file to seek to, `clipStart`
// is the clip's own absolute startTime (its output-time origin).
export function toEntry(clip, time) {
  const speed = clip.speed || 1;
  const rawOutputElapsed = time - clip.startTime;
  // A frozen clip (M11 freeze frame) always shows the single source frame
  // at trimmedStart, regardless of how far into the clip's own duration
  // playback has advanced - matches the backend's tpad-based hold (see
  // backend/services/filterGraph/effects/trim.js). A reversed clip seeks
  // backward from trimmedEnd instead of forward from trimmedStart, the
  // preview's approximation of the export's real reverse/areverse filters.
  // A speed-curve clip (M12) maps elapsed output time through its stepped
  // segments (see timeline/speedCurve.js) instead of one flat multiplier -
  // mirrors the backend's per-segment trim+setpts+concat export.
  let localTime;
  if (clip.frozen) {
    localTime = clip.trimmedStart;
  } else if (clip.reversed) {
    localTime = clip.trimmedEnd - rawOutputElapsed * speed;
  } else if (hasSpeedCurve(clip)) {
    localTime = clip.trimmedStart + sourceTimeForOutputElapsed(clip, rawOutputElapsed);
  } else {
    localTime = clip.trimmedStart + rawOutputElapsed * speed;
  }
  return { clip, localTime, clipStart: clip.startTime, duration: clipDuration(clip) };
}

// Finds the active clip (plus transition partner/progress) within ONE
// lane - transitions only ever blend two clips on the *same* lane (see
// transitions.js), so this operates per-lane; callers iterate every lane.
export function findActiveInLane(laneClips, time) {
  const active = resolveActiveInLane(laneClips, time);
  if (!active) return null;
  const result = { primary: toEntry(active.primary, time) };
  if (active.next) {
    result.next = toEntry(active.next, time);
    result.progress = active.progress;
  }
  return result;
}

export function findActiveTextInLane(laneClips, time) {
  return laneClips.find((clip) => time >= clip.startTime && time < clip.startTime + clipDuration(clip)) || null;
}

// Standalone audio-track clips (music/voiceover) - no transitions on this
// track, just absolute-time containment.
export function findActiveAudioInLane(laneClips, time) {
  const clip = laneClips.find((c) => time >= c.startTime && time < c.startTime + clipDuration(c));
  if (!clip) return null;
  const speed = clip.speed || 1;
  const outputLocalTime = time - clip.startTime;
  const localTime = hasSpeedCurve(clip)
    ? clip.trimmedStart + sourceTimeForOutputElapsed(clip, outputLocalTime)
    : clip.trimmedStart + outputLocalTime * speed;
  return { clip, clipStart: clip.startTime, duration: clipDuration(clip), localTime, outputLocalTime };
}

// Resolves a clip's gain (0..~2) at a given point in its own output
// timeline: keyframed volume envelope (or the static volume when no
// envelope exists - same "keyframes replace static value when present"
// pattern RightPanel's transform commits use), then fade in/out layered on
// top. Mirrors the backend's applyAudioLevels + volumeEnvelope so the
// preview and the exported audio agree. `allowReversed` is for the export,
// which really reverses audio; the live preview can't and silences it.
export function resolveClipGain(clip, outputLocalTime, duration, { allowReversed = false } = {}) {
  if (clip.muted || (clip.reversed && !allowReversed)) return 0;
  const kf = clip.keyframes || {};
  const base = typeof clip.volume === 'number' ? clip.volume : 1;
  let vol = resolveKeyframedValue(kf.volume, outputLocalTime, base);
  const fadeIn = clip.audioFade?.in || 0;
  const fadeOut = clip.audioFade?.out || 0;
  if (fadeIn > 0 && outputLocalTime < fadeIn) vol *= Math.max(0, outputLocalTime / fadeIn);
  if (fadeOut > 0 && duration - outputLocalTime < fadeOut) vol *= Math.max(0, (duration - outputLocalTime) / fadeOut);
  return Math.max(0, vol);
}

// Draws one clip's picture: fit (contain/cover), keyframed transform,
// opacity, colour filter, chroma key and vignette. `source` is
// { image, width, height } or null when no frame is available yet.
// options: fitMode, getChromaKeyCanvas(clipId, w, h), getScratchCanvas(key,
// w, h) and exactColor (apply temperature - export only).
export function drawClipPicture(ctx, canvas, entry, time, compositeAlpha, source, options = {}) {
  const { clip, clipStart } = entry;
  const clipOutputTime = time - clipStart;
  const t = clip.transform || {};
  // Scale, position, rotation and opacity all animate via keyframes when
  // present, falling back to the static transform otherwise. The flip
  // (the sign of scaleX/scaleY) always comes from the static transform -
  // a keyframe track carries magnitude only, matching the export, which
  // applies hflip/vflip up front and feeds the keyframed magnitude into
  // scale's per-frame expression (see
  // backend/services/filterGraph/effects/transform.js).
  const kf = clip.keyframes || {};
  const staticScaleX = typeof t.scaleX === 'number' ? t.scaleX : 1;
  const staticScaleY = typeof t.scaleY === 'number' ? t.scaleY : 1;
  const scaleX = resolveKeyframedValue(kf.scaleX, clipOutputTime, Math.abs(staticScaleX)) * (staticScaleX < 0 ? -1 : 1);
  const scaleY = resolveKeyframedValue(kf.scaleY, clipOutputTime, Math.abs(staticScaleY)) * (staticScaleY < 0 ? -1 : 1);
  const opacity = resolveKeyframedValue(kf.opacity, clipOutputTime, typeof t.opacity === 'number' ? t.opacity : 1);
  const rotation = resolveKeyframedValue(kf.rotation, clipOutputTime, t.rotation || 0);
  const posX = resolveKeyframedValue(kf.x, clipOutputTime, t.x || 0);
  const posY = resolveKeyframedValue(kf.y, clipOutputTime, t.y || 0);
  const combinedAlpha = Math.max(0, Math.min(1, opacity)) * compositeAlpha;

  const vw = source?.width || canvas.width;
  const vh = source?.height || canvas.height;
  if (source?.image && vw > 0 && vh > 0) {
    // 'cover' scales up to fill the canvas (cropping overflow) instead of
    // 'contain'-fitting inside it with letterbox/pillarbox bars - mirrors
    // backend/services/filterGraph/effects/transform.js's isCover branch.
    const isCover = options.fitMode === 'cover';
    const fitScale = isCover ? Math.max(canvas.width / vw, canvas.height / vh) : Math.min(canvas.width / vw, canvas.height / vh);
    const drawW = vw * fitScale * Math.abs(scaleX);
    const drawH = vh * fitScale * Math.abs(scaleY);

    ctx.save();
    if (isCover) {
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.clip();
    }
    ctx.globalAlpha = combinedAlpha;
    ctx.filter = cssFilterForClip(clip);
    // posX/posY are a percent of half the canvas dimension (0=center,
    // +/-100=edge of frame) - see backend/services/filterGraph/effects/
    // transform.js's overlay x/y expressions for the mirrored export-side
    // formula, which must stay identical to this one.
    ctx.translate(canvas.width / 2 + (posX * canvas.width) / 200, canvas.height / 2 + (posY * canvas.height) / 200);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scaleX < 0 ? -1 : 1, scaleY < 0 ? -1 : 1);
    try {
      const chromaKeyFilter = (clip.filters || []).find((f) => f.type === 'chromaKey' && f.enabled !== false);
      const temperature = options.exactColor ? temperatureOf(clip) : 0;
      if (chromaKeyFilter || temperature) {
        // Pixel work happens at the source's native resolution (not the
        // scaled-up canvas size) - cheaper, and matches the backend applying
        // colorkey= before its own scale step. One reused canvas per clip id.
        const offscreen = options.getChromaKeyCanvas(clip.id, vw, vh);
        const octx = offscreen.getContext('2d', { willReadFrequently: true });
        octx.clearRect(0, 0, vw, vh);
        octx.drawImage(source.image, 0, 0, vw, vh);
        if (temperature) applyTemperature(octx, vw, vh, temperature);
        if (chromaKeyFilter) {
          const { color = '#00ff00', similarity = 35, blend = 15 } = chromaKeyFilter.params || {};
          const imageData = octx.getImageData(0, 0, vw, vh);
          chromaKeyImageData(imageData, hexToRgb(color), (Number(similarity) || 0) / 100, (Number(blend) || 0) / 100);
          octx.putImageData(imageData, 0, 0);
        }
        ctx.drawImage(offscreen, -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        ctx.drawImage(source.image, -drawW / 2, -drawH / 2, drawW, drawH);
      }
    } catch { /* frame not decoded yet */ }
    ctx.restore();
  }

  const vignetteIntensity = (clip.filters || []).find((filter) => filter.type === 'vignette' && filter.enabled !== false)?.params?.intensity;
  if (vignetteIntensity > 0) {
    ctx.save();
    ctx.globalAlpha = combinedAlpha;
    drawVignette(ctx, canvas, vignetteIntensity);
    ctx.restore();
  }
}

// Adjustment layers (M13) carry no media of their own - they apply their
// color/vignette filters to everything already drawn below them in the
// ascending-trackIndex z-order (see renderTimelineFrame's lane loop) rather
// than drawing new content. Snapshotting the canvas-so-far and redrawing
// it through ctx.filter is the Canvas2D equivalent of the backend's
// enable-gated eq=/vignette= applied to the running composite label - see
// backend/services/filterGraph/index.js, empirically verified before
// wiring in.
export function applyAdjustmentLayer(ctx, canvas, clip, options = {}) {
  const filterStr = cssFilterForClip(clip);
  const temperature = options.exactColor ? temperatureOf(clip) : 0;
  const vignetteIntensity = (clip.filters || []).find((filter) => filter.type === 'vignette' && filter.enabled !== false)?.params?.intensity || 0;
  if (filterStr === 'none' && !temperature && vignetteIntensity <= 0) return;

  if (filterStr !== 'none') {
    const snapshot = options.getScratchCanvas ? options.getScratchCanvas('adjustment', canvas.width, canvas.height) : document.createElement('canvas');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    snapshot.getContext('2d').drawImage(canvas, 0, 0);
    ctx.save();
    ctx.filter = filterStr;
    ctx.drawImage(snapshot, 0, 0);
    ctx.restore();
  }
  if (temperature) applyTemperature(ctx, canvas.width, canvas.height, temperature);

  if (vignetteIntensity > 0) {
    drawVignette(ctx, canvas, vignetteIntensity);
  }
}

// ffmpeg xfade's transitions, drawn from two full-canvas layers. `p` runs
// 0 -> 1 across the overlap (xfade's own progress runs 1 -> 0).
let dissolveNoise = null;
function noiseFor(width, height) {
  if (!dissolveNoise || dissolveNoise.length !== width * height) {
    // Fixed pattern, like xfade's per-pixel noise, so the dissolve doesn't
    // flicker between frames.
    let seed = 1;
    dissolveNoise = new Float32Array(width * height);
    for (let i = 0; i < dissolveNoise.length; i += 1) {
      seed = (seed * 16807) % 2147483647;
      dissolveNoise[i] = seed / 2147483647;
    }
  }
  return dissolveNoise;
}

export function composeTransition(ctx, canvas, type, p, layerA, layerB, getScratchCanvas) {
  const w = canvas.width;
  const h = canvas.height;
  switch (type) {
    case 'fadeblack': {
      if (p < 0.5) {
        ctx.drawImage(layerA, 0, 0);
        ctx.save();
        ctx.globalAlpha = p * 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = (p - 0.5) * 2;
        ctx.drawImage(layerB, 0, 0);
        ctx.restore();
      }
      return;
    }
    case 'wipeleft':
    case 'wiperight': {
      ctx.drawImage(layerA, 0, 0);
      const bx = type === 'wipeleft' ? w * (1 - p) : 0;
      const bw = w * p;
      if (bw > 0) ctx.drawImage(layerB, bx, 0, bw, h, bx, 0, bw, h);
      return;
    }
    case 'slideleft':
    case 'slideright': {
      const dir = type === 'slideleft' ? -1 : 1;
      ctx.drawImage(layerA, dir * p * w, 0);
      ctx.drawImage(layerB, dir * p * w - dir * w, 0);
      return;
    }
    case 'circleopen':
    case 'circleclose': {
      const maxR = Math.hypot(w / 2, h / 2);
      const opening = type === 'circleopen';
      ctx.drawImage(opening ? layerA : layerB, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, maxR * (opening ? p : 1 - p), 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(opening ? layerB : layerA, 0, 0);
      ctx.restore();
      return;
    }
    case 'dissolve': {
      const scratch = getScratchCanvas('dissolve', w, h);
      const sctx = scratch.getContext('2d', { willReadFrequently: true });
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(layerA, 0, 0);
      const a = sctx.getImageData(0, 0, w, h);
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(layerB, 0, 0);
      const b = sctx.getImageData(0, 0, w, h);
      const noise = noiseFor(w, h);
      for (let i = 0, px = 0; px < noise.length; px += 1, i += 4) {
        if (noise[px] < p) {
          a.data[i] = b.data[i];
          a.data[i + 1] = b.data[i + 1];
          a.data[i + 2] = b.data[i + 2];
          a.data[i + 3] = b.data[i + 3];
        }
      }
      sctx.putImageData(a, 0, 0);
      ctx.drawImage(scratch, 0, 0);
      return;
    }
    case 'pixelize': {
      // Blocks grow to min(w,h)/20 at the midpoint and shrink again while
      // the two pictures cross-fade - xfade's pixelize.
      const d = Math.min(p, 1 - p);
      const block = Math.max(1, Math.round(2 * (Math.ceil(d * 50) / 50) * Math.min(w, h) / 20));
      const mixed = getScratchCanvas('pixelize-mix', w, h);
      const mctx = mixed.getContext('2d');
      mctx.clearRect(0, 0, w, h);
      mctx.drawImage(layerA, 0, 0);
      mctx.globalAlpha = p;
      mctx.drawImage(layerB, 0, 0);
      mctx.globalAlpha = 1;
      if (block <= 1) {
        ctx.drawImage(mixed, 0, 0);
        return;
      }
      const sw = Math.max(1, Math.round(w / block));
      const sh = Math.max(1, Math.round(h / block));
      const small = getScratchCanvas('pixelize-small', sw, sh);
      const smctx = small.getContext('2d');
      smctx.clearRect(0, 0, sw, sh);
      smctx.drawImage(mixed, 0, 0, sw, sh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, w, h);
      ctx.restore();
      return;
    }
    default: {
      // 'fade' - and anything unknown, like the server's resolveXfadeType.
      ctx.drawImage(layerA, 0, 0);
      ctx.save();
      ctx.globalAlpha = p;
      ctx.drawImage(layerB, 0, 0);
      ctx.restore();
    }
  }
}

// One full frame of the timeline at `time`: black background, video lanes
// back-to-front (with adjustment layers and transitions), then text and
// captions. `getSource(entry)` returns { image, width, height } or null.
export function renderTimelineFrame(ctx, canvas, time, { videoLanes, textLanes, trackMeta, getSource, fitMode, getChromaKeyCanvas, getScratchCanvas, exactColor = false }) {
  const pictureOptions = { fitMode, getChromaKeyCanvas, getScratchCanvas, exactColor };
  const drawEntry = (targetCtx, entry, alpha) => drawClipPicture(targetCtx, canvas, entry, time, alpha, getSource(entry), pictureOptions);

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Ascending trackIndex order = back-to-front z-order, so lane 1+
  // (overlay/PiP content) naturally draws on top of lane 0 (background).
  videoLanes.forEach((laneClips) => {
    const laneIndex = laneClips[0]?.trackIndex || 0;
    if (trackMeta?.video?.[laneIndex]?.hidden) return;
    const active = findActiveInLane(laneClips, time);
    if (!active) return;
    if (active.primary.clip.type === 'adjustment') {
      applyAdjustmentLayer(ctx, canvas, active.primary.clip, pictureOptions);
      return;
    }
    const type = active.primary.clip.transitionOut?.type || 'fade';
    if (!active.next || type === 'fade') {
      // The outgoing clip opaque, the incoming one on top at the transition
      // progress - the same opacity blend as ffmpeg's xfade fade.
      drawEntry(ctx, active.primary, 1);
      if (active.next) drawEntry(ctx, active.next, active.progress);
      return;
    }
    // Other transitions need each clip as its own layer first.
    const layerA = getScratchCanvas('transition-a', canvas.width, canvas.height);
    const layerB = getScratchCanvas('transition-b', canvas.width, canvas.height);
    const actx = layerA.getContext('2d');
    const bctx = layerB.getContext('2d');
    actx.clearRect(0, 0, canvas.width, canvas.height);
    bctx.clearRect(0, 0, canvas.width, canvas.height);
    drawEntry(actx, active.primary, 1);
    drawEntry(bctx, active.next, 1);
    composeTransition(ctx, canvas, type, active.progress, layerA, layerB, getScratchCanvas);
  });

  textLanes.forEach((laneClips) => {
    const laneIndex = laneClips[0]?.trackIndex || 0;
    if (trackMeta?.text?.[laneIndex]?.hidden) return;
    const activeText = findActiveTextInLane(laneClips, time);
    if (!activeText) return;
    if (activeText.text?.caption) drawCaption(ctx, activeText, canvas, time - activeText.startTime + (activeText.trimmedStart || 0));
    else drawTextClip(ctx, activeText, canvas);
  });

  ctx.restore();
}

// A tiny pool of reusable canvases keyed by purpose, resized on demand.
export function createCanvasPool() {
  const pool = new Map();
  return (key, width, height) => {
    let canvas = pool.get(key);
    if (!canvas) {
      canvas = document.createElement('canvas');
      pool.set(key, canvas);
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  };
}

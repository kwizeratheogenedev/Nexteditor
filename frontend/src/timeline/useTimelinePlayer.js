import { useCallback, useEffect, useRef } from 'react';
import { resolveKeyframedValue } from './keyframes';
import { resolveActiveInLane, clipDuration, laneTotalDuration } from './transitions';
import { hasSpeedCurve, sourceTimeForOutputElapsed } from './speedCurve';

// Matches the fixed 1080p/16:9 canvas the backend exporter renders to
// (see backend/routes/exportTimeline.js CANVAS) so the live preview and the
// exported file agree on framing.
export const CANVAS_SIZE = { width: 1920, height: 1080 };

// Groups a media type's clips by trackIndex into lanes, sorted ascending -
// for video this ordering IS the z-order (lane 0 = background, drawn
// first; higher lanes layer on top, matching CapCut's "track above sits in
// front"). For audio/text there's no z-order meaning, but a stable
// iteration order is still convenient.
function groupLanes(clips) {
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
function cssFilterForClip(clip) {
  const colorFilter = (clip.filters || []).find((filter) => filter.type === 'color' && filter.enabled !== false);
  if (!colorFilter) return 'none';
  const { brightness = 0, contrast = 0, saturation = 0 } = colorFilter.params || {};
  const b = Math.max(0, 1 + brightness / 100);
  const c = Math.max(0, 1 + contrast / 100);
  const s = Math.max(0, 1 + saturation / 100);
  // Temperature has no direct Canvas2D filter equivalent - the preview
  // intentionally skips it rather than faking a rough approximation; the
  // exported video still applies it (via colorbalance=) since ffmpeg has no
  // such limitation.
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

// Darkens the frame edges with a radial gradient. Approximates the
// backend's native ffmpeg `vignette` filter (see
// backend/services/filterGraph/effects/vignette.js) closely enough for
// preview purposes - the two aren't pixel-identical (ffmpeg's is a true
// optical/lens-style falloff) but land in the same visual neighborhood.
function drawVignette(ctx, canvas, intensity) {
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

function drawTextClip(ctx, clip, canvas) {
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
function toEntry(clip, time) {
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
function findActiveInLane(laneClips, time) {
  const active = resolveActiveInLane(laneClips, time);
  if (!active) return null;
  const result = { primary: toEntry(active.primary, time) };
  if (active.next) {
    result.next = toEntry(active.next, time);
    result.progress = active.progress;
  }
  return result;
}

function findActiveTextInLane(laneClips, time) {
  return laneClips.find((clip) => time >= clip.startTime && time < clip.startTime + clipDuration(clip)) || null;
}

// Standalone audio-track clips (music/voiceover) - no transitions on this
// track, just absolute-time containment.
function findActiveAudioInLane(laneClips, time) {
  const clip = laneClips.find((c) => time >= c.startTime && time < c.startTime + clipDuration(c));
  if (!clip) return null;
  const speed = clip.speed || 1;
  const outputLocalTime = time - clip.startTime;
  const localTime = hasSpeedCurve(clip)
    ? clip.trimmedStart + sourceTimeForOutputElapsed(clip, outputLocalTime)
    : clip.trimmedStart + outputLocalTime * speed;
  return { clip, clipStart: clip.startTime, duration: clipDuration(clip), localTime, outputLocalTime };
}

// Resolves a clip's live-preview gain (0..~2) at a given point in its own
// output timeline: keyframed volume envelope (or the static volume when no
// envelope exists - same "keyframes replace static value when present"
// pattern RightPanel's transform commits use), then fade in/out layered on
// top. Mirrors the backend's applyAudioLevels + volumeEnvelope so the
// preview and the exported audio agree.
function resolveClipGain(clip, outputLocalTime, clipDuration) {
  // Real reversed audio isn't feasible through the pooled-element/Web Audio
  // preview graph (no native negative playback rate) - silence it live and
  // let the export's real `areverse` filter be the source of truth for what
  // reversed audio actually sounds like.
  if (clip.muted || clip.reversed) return 0;
  const kf = clip.keyframes || {};
  const base = typeof clip.volume === 'number' ? clip.volume : 1;
  let vol = resolveKeyframedValue(kf.volume, outputLocalTime, base);
  const fadeIn = clip.audioFade?.in || 0;
  const fadeOut = clip.audioFade?.out || 0;
  if (fadeIn > 0 && outputLocalTime < fadeIn) vol *= Math.max(0, outputLocalTime / fadeIn);
  if (fadeOut > 0 && clipDuration - outputLocalTime < fadeOut) vol *= Math.max(0, (clipDuration - outputLocalTime) / fadeOut);
  return Math.max(0, vol);
}

// Drives the Editor tab's live preview: composites pooled offscreen <video>
// elements (one per unique source near the playhead) and text overlays onto
// a <canvas>, driven by externally-controlled currentTime/isPlaying so it
// stays a plain controlled component from App.jsx's point of view. Since
// M8, every video/audio/text lane renders (not just lane 0) - video lanes
// stack in z-order for real picture-in-picture/overlays, audio lanes all
// mix together, text lanes all draw. Only lane 0's video defines the
// program's overall length (matches the backend export).
export function useTimelinePlayer({ timeline, currentTime, isPlaying, onTimeUpdate, onEnded, onClipDurationUpdate, canvasRef, trackMeta }) {
  const videoPoolRef = useRef(new Map());
  const audioPoolRef = useRef(new Map());
  const videoGainNodesRef = useRef(new Map());
  const audioGainNodesRef = useRef(new Map());
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const lastTickRef = useRef(null);
  const currentTimeRef = useRef(currentTime);
  const isPlayingRef = useRef(isPlaying);
  const reportedDurationsRef = useRef(new Map());
  // A pooled <video>'s src/currentTime assignment loads and seeks
  // asynchronously - drawFrame is only re-triggered by React state changes,
  // so without this, the very first frame (or a fresh seek) can render
  // nothing until some unrelated state change happens to redraw. These
  // refs let the element's own 'loadeddata'/'seeked' listeners (attached
  // once, outside React) call back into the latest draw function.
  const drawFrameRef = useRef(() => {});

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Adjustment layers (M13) live on video lanes for z-order (see
  // createAdjustmentClip) - grouped/drawn alongside real video clips here.
  const videoClips = timeline.filter((clip) => clip.type === 'video' || clip.type === 'adjustment' || !clip.type);
  const audioTrackClips = timeline.filter((clip) => clip.type === 'audio');
  const textClips = timeline.filter((clip) => clip.type === 'text');
  // A disabled clip (M11) still occupies its slot on the timeline - it just
  // renders nothing - so duration math below stays on the unfiltered arrays
  // and only the lane-building used for actually drawing/playing excludes
  // disabled clips.
  const videoLanes = groupLanes(videoClips.filter((clip) => clip.enabled !== false));
  const audioLanes = groupLanes(audioTrackClips.filter((clip) => clip.enabled !== false));
  const textLanes = groupLanes(textClips.filter((clip) => clip.enabled !== false));
  // The program's overall length is still lane 0's alone (matches the
  // backend, which only chains lane 0 into "the program" - see
  // backend/services/filterGraph/index.js); other lanes can run
  // shorter/longer without affecting playback bounds. Adjustment layers
  // never define the program length, same reasoning that already excludes
  // this from being driven by anything but real base video.
  const laneZeroVideoClips = videoClips.filter((clip) => (clip.trackIndex || 0) === 0 && clip.type !== 'adjustment');
  const videoDuration = laneTotalDuration(laneZeroVideoClips, clipDuration);

  // Lazily-created singleton AudioContext shared by every pooled video/audio
  // element's Web Audio graph. Created on first use rather than at mount so
  // it doesn't spin up before the editor tab even has any media - browsers
  // start it 'suspended' either way until resume() is called (see the
  // isPlaying effect below, which resumes it right after the Play click).
  const getAudioContext = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtxRef.current = new Ctor();
    return audioCtxRef.current;
  }, []);

  // Wires one pooled media element into the shared Web Audio graph via
  // MediaElementSourceNode -> GainNode -> destination, caching the GainNode
  // in `gainNodesMap` (keyed the same way the element pool is) so per-frame
  // volume/fade/keyframe updates can just set `gain.value`. Must only run
  // once per element - createMediaElementSource throws if called twice on
  // the same element - which is naturally satisfied since this is only
  // called from inside each pool's `if (!el)` creation branch.
  const connectToAudioGraph = useCallback((el, sourceId, gainNodesMap) => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(ctx.destination);
      gainNodesMap.set(sourceId, gain);
    } catch { /* unsupported or already connected */ }
  }, [getAudioContext]);

  const getVideoElement = useCallback((clip) => {
    const pool = videoPoolRef.current;
    let el = pool.get(clip.sourceId);
    if (!el) {
      el = document.createElement('video');
      // Native output stays muted - once createMediaElementSource taps the
      // element (connectToAudioGraph below), its decoded audio reaches the
      // speakers exclusively through the Web Audio graph regardless of this
      // flag, so leaving it true just avoids doubled audio.
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      const redraw = () => {
        if (!isPlayingRef.current) drawFrameRef.current(currentTimeRef.current);
      };
      el.addEventListener('loadeddata', redraw);
      el.addEventListener('seeked', redraw);
      pool.set(clip.sourceId, el);
      connectToAudioGraph(el, clip.sourceId, videoGainNodesRef.current);
    }
    if (clip.url && el.src !== clip.url) {
      el.src = clip.url;
    }
    return el;
  }, [connectToAudioGraph]);

  const getAudioElement = useCallback((clip) => {
    const pool = audioPoolRef.current;
    let el = pool.get(clip.sourceId);
    if (!el) {
      el = document.createElement('audio');
      el.muted = true; // same reasoning as getVideoElement above
      el.preload = 'auto';
      pool.set(clip.sourceId, el);
      connectToAudioGraph(el, clip.sourceId, audioGainNodesRef.current);
    }
    if (clip.url && el.src !== clip.url) {
      el.src = clip.url;
    }
    return el;
  }, [connectToAudioGraph]);

  // Drop pooled elements (and their Web Audio gain nodes) for sources no
  // longer referenced by any clip.
  useEffect(() => {
    const activeVideoSourceIds = new Set(videoClips.map((clip) => clip.sourceId));
    for (const [sourceId, el] of videoPoolRef.current.entries()) {
      if (!activeVideoSourceIds.has(sourceId)) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        videoPoolRef.current.delete(sourceId);
        videoGainNodesRef.current.get(sourceId)?.disconnect();
        videoGainNodesRef.current.delete(sourceId);
      }
    }

    const activeAudioSourceIds = new Set(audioTrackClips.map((clip) => clip.sourceId));
    for (const [sourceId, el] of audioPoolRef.current.entries()) {
      if (!activeAudioSourceIds.has(sourceId)) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        audioPoolRef.current.delete(sourceId);
        audioGainNodesRef.current.get(sourceId)?.disconnect();
        audioGainNodesRef.current.delete(sourceId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  // Draws one active video entry (primary, or the incoming clip during a
  // transitionOut overlap) onto the canvas. `compositeAlpha` layers on top
  // of the clip's own opacity - 1 outside a transition, ramping 0->1 for the
  // incoming clip while it crossfades in. Canvas's normal source-over
  // compositing does the rest: drawing the outgoing clip opaque first, then
  // the incoming clip at globalAlpha=progress on top, reproduces the same
  // opacity-blend a ffmpeg `xfade=transition=fade` produces. Called once per
  // active lane, in ascending trackIndex order, so higher lanes naturally
  // layer on top of lower ones (real picture-in-picture/overlays).
  const drawVideoEntry = useCallback((ctx, canvas, entry, time, compositeAlpha) => {
    const { clip, localTime, clipStart } = entry;
    const clipOutputTime = time - clipStart;
    const el = getVideoElement(clip);

    if (Number.isFinite(el.duration) && el.duration > 0) {
      const prevReported = reportedDurationsRef.current.get(clip.id);
      if (onClipDurationUpdate && prevReported !== el.duration && Math.abs((clip.duration || 0) - el.duration) > 0.5) {
        reportedDurationsRef.current.set(clip.id, el.duration);
        onClipDurationUpdate(clip.id, el.duration);
      }
    }

    // A frozen or reversed clip's element is kept paused (see the play/pause
    // sync effect below) and only ever advances via explicit seeks here, so
    // it needs a much tighter drift threshold than a normally-playing clip
    // (which free-runs and only needs occasional resync) - but NOT an
    // unconditional reseek every draw: reassigning currentTime to the value
    // it's already at can still fire a browser's 'seeking'/'seeked' events,
    // and since those events themselves trigger another drawFrame call (see
    // getVideoElement's `redraw` listener below), an unconditional reseek
    // creates a self-sustaining redraw loop that starves the actual
    // drawImage call and left the canvas showing only the black background
    // fill - reproduced and confirmed via temporary instrumentation before
    // this fix. Reversed playback in particular is simulated entirely by
    // seeking backward each frame (real reverse decode/playback isn't
    // available on an HTML <video>; the export's ffmpeg `reverse`/`areverse`
    // filters are frame/audio-accurate, this is just an approximate preview).
    const seekThreshold = (clip.frozen || clip.reversed) ? 0.03 : 0.15;
    if (el.readyState >= 1 && Math.abs(el.currentTime - localTime) > seekThreshold) {
      try {
        el.currentTime = Math.max(0, localTime);
      } catch { /* element not seekable yet */ }
    }

    const t = clip.transform || {};
    const scaleX = typeof t.scaleX === 'number' ? t.scaleX : 1;
    const scaleY = typeof t.scaleY === 'number' ? t.scaleY : 1;
    // Position/rotation/opacity animate via keyframes when present (see
    // hooks/usePersistedEditorState.js normalizeClip for why scale isn't
    // keyframeable yet); otherwise they fall back to the static transform.
    const kf = clip.keyframes || {};
    const opacity = resolveKeyframedValue(kf.opacity, clipOutputTime, typeof t.opacity === 'number' ? t.opacity : 1);
    const rotation = resolveKeyframedValue(kf.rotation, clipOutputTime, t.rotation || 0);
    const posX = resolveKeyframedValue(kf.x, clipOutputTime, t.x || 0);
    const posY = resolveKeyframedValue(kf.y, clipOutputTime, t.y || 0);
    const combinedAlpha = Math.max(0, Math.min(1, opacity)) * compositeAlpha;

    const vw = el.videoWidth || canvas.width;
    const vh = el.videoHeight || canvas.height;
    if (vw > 0 && vh > 0 && el.readyState >= 2) {
      const fitScale = Math.min(canvas.width / vw, canvas.height / vh);
      const drawW = vw * fitScale * Math.abs(scaleX);
      const drawH = vh * fitScale * Math.abs(scaleY);

      ctx.save();
      ctx.globalAlpha = combinedAlpha;
      ctx.filter = cssFilterForClip(clip);
      ctx.translate(canvas.width / 2 + posX, canvas.height / 2 + posY);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scaleX < 0 ? -1 : 1, scaleY < 0 ? -1 : 1);
      try {
        ctx.drawImage(el, -drawW / 2, -drawH / 2, drawW, drawH);
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
  }, [getVideoElement, onClipDurationUpdate]);

  // Adjustment layers (M13) carry no media of their own - they apply their
  // color/vignette filters to everything already drawn below them in the
  // ascending-trackIndex z-order (see drawFrame's videoLanes loop) rather
  // than drawing new content. Snapshotting the canvas-so-far and redrawing
  // it through ctx.filter is the Canvas2D equivalent of the backend's
  // enable-gated eq=/vignette= applied to the running composite label - see
  // backend/services/filterGraph/index.js, empirically verified before
  // wiring in.
  const applyAdjustmentLayer = useCallback((ctx, canvas, clip) => {
    const filterStr = cssFilterForClip(clip);
    const vignetteIntensity = (clip.filters || []).find((filter) => filter.type === 'vignette' && filter.enabled !== false)?.params?.intensity || 0;
    if (filterStr === 'none' && vignetteIntensity <= 0) return;

    if (filterStr !== 'none') {
      const snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext('2d').drawImage(canvas, 0, 0);
      ctx.save();
      ctx.filter = filterStr;
      ctx.drawImage(snapshot, 0, 0);
      ctx.restore();
    }

    if (vignetteIntensity > 0) {
      drawVignette(ctx, canvas, vignetteIntensity);
    }
  }, []);

  // Seeks every active audio-track element and updates every pooled
  // element's GainNode for the current instant, across every video and
  // audio lane - the audio counterpart to drawFrame's video compositing.
  // Runs on every drawn frame (playing or scrubbing) so volume/fade/
  // keyframe envelopes track the playhead smoothly. Every element is
  // muted-by-default each call so a clip that just went inactive (scrubbed
  // past, track content changed) doesn't keep sounding.
  const updateAudioGains = useCallback((time) => {
    videoGainNodesRef.current.forEach((gain) => { gain.gain.value = 0; });
    audioGainNodesRef.current.forEach((gain) => { gain.gain.value = 0; });

    videoLanes.forEach((laneClips) => {
      const active = findActiveInLane(laneClips, time);
      if (!active) return;
      const primaryOutputTime = time - active.primary.clipStart;
      // During a transitionOut overlap the two clips' audio linearly
      // crossfades same as the exported acrossfade - unlike the canvas draw
      // (which relies on plain alpha-over compositing), separate GainNodes
      // sum in the audio graph, so both sides need their mix multiplied in
      // explicitly.
      const primaryMix = active.next ? 1 - active.progress : 1;
      const primaryGain = videoGainNodesRef.current.get(active.primary.clip.sourceId);
      if (primaryGain) {
        primaryGain.gain.value = resolveClipGain(active.primary.clip, primaryOutputTime, active.primary.duration) * primaryMix;
      }
      if (active.next) {
        const nextOutputTime = time - active.next.clipStart;
        const nextGain = videoGainNodesRef.current.get(active.next.clip.sourceId);
        if (nextGain) {
          nextGain.gain.value = resolveClipGain(active.next.clip, nextOutputTime, active.next.duration) * active.progress;
        }
      }
    });

    audioLanes.forEach((laneClips) => {
      const laneIndex = laneClips[0]?.trackIndex || 0;
      if (trackMeta?.audio?.[laneIndex]?.hidden) return; // hidden = muted for the standalone audio track
      const activeAudio = findActiveAudioInLane(laneClips, time);
      if (!activeAudio) return;
      const el = getAudioElement(activeAudio.clip);
      if (el.readyState >= 1 && Math.abs(el.currentTime - activeAudio.localTime) > 0.15) {
        try {
          el.currentTime = activeAudio.localTime;
        } catch { /* element not seekable yet */ }
      }
      const gain = audioGainNodesRef.current.get(activeAudio.clip.sourceId);
      if (gain) {
        gain.gain.value = resolveClipGain(activeAudio.clip, activeAudio.outputLocalTime, activeAudio.duration);
      }
    });
  }, [videoLanes, audioLanes, getAudioElement, trackMeta]);

  const drawFrame = useCallback((time) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== CANVAS_SIZE.width) canvas.width = CANVAS_SIZE.width;
    if (canvas.height !== CANVAS_SIZE.height) canvas.height = CANVAS_SIZE.height;
    const ctx = canvas.getContext('2d');

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
        applyAdjustmentLayer(ctx, canvas, active.primary.clip);
        return;
      }
      drawVideoEntry(ctx, canvas, active.primary, time, 1);
      if (active.next) {
        drawVideoEntry(ctx, canvas, active.next, time, active.progress);
      }
    });

    textLanes.forEach((laneClips) => {
      const laneIndex = laneClips[0]?.trackIndex || 0;
      if (trackMeta?.text?.[laneIndex]?.hidden) return;
      const activeText = findActiveTextInLane(laneClips, time);
      if (activeText) drawTextClip(ctx, activeText, canvas);
    });

    ctx.restore();
    updateAudioGains(time);
  }, [videoLanes, textLanes, drawVideoEntry, applyAdjustmentLayer, updateAudioGains, canvasRef, trackMeta]);

  useEffect(() => {
    drawFrameRef.current = drawFrame;
  }, [drawFrame]);

  // Redraw a static frame whenever paused and the target time or timeline
  // content changes (trims, transforms, selection edits, etc).
  useEffect(() => {
    if (!isPlaying) drawFrame(currentTime);
  }, [isPlaying, currentTime, timeline, drawFrame]);

  // Playback loop: advances currentTime by real elapsed time each frame,
  // reporting back through onTimeUpdate (the same controlled callback a
  // <video onTimeUpdate> would have driven).
  useEffect(() => {
    if (!isPlaying) {
      lastTickRef.current = null;
      return undefined;
    }

    const tick = (now) => {
      if (lastTickRef.current == null) lastTickRef.current = now;
      const deltaSeconds = Math.min(0.25, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      const next = currentTimeRef.current + deltaSeconds;
      if (next >= videoDuration) {
        currentTimeRef.current = videoDuration;
        drawFrame(videoDuration);
        onTimeUpdate(videoDuration);
        onEnded?.();
        return;
      }

      currentTimeRef.current = next;
      drawFrame(next);
      onTimeUpdate(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
    };
    // Intentionally excludes onTimeUpdate/onEnded/drawFrame/videoDuration:
    // this loop reads them fresh via closure each tick is fine since it's
    // torn down and restarted whenever `isPlaying` flips, which is the only
    // transition that should reset the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Keep the underlying <video>/<audio> elements' own play/pause state in
  // step with the rAF-driven draw loop, so decoding keeps up while playing.
  // During a transitionOut overlap both the outgoing and incoming clip's
  // elements need to be playing at once so the crossfade has live frames on
  // both sides; across lanes, every lane's currently-active clip(s) play
  // simultaneously (that's the whole point of picture-in-picture).
  useEffect(() => {
    const activeVideoSourceIds = new Set();
    videoLanes.forEach((laneClips) => {
      const active = findActiveInLane(laneClips, currentTime);
      if (!active) return;
      // A frozen or reversed clip (M11) must never free-play forward -
      // drawVideoEntry drives both entirely via repeated seeks, which only
      // reads cleanly on a paused element (playing forward would fight the
      // seek every frame, and there's no native backward playback anyway).
      const primaryPaused = active.primary.clip.frozen || active.primary.clip.reversed;
      if (!primaryPaused) activeVideoSourceIds.add(active.primary.clip.sourceId);
      if (active.next && !(active.next.clip.frozen || active.next.clip.reversed)) activeVideoSourceIds.add(active.next.clip.sourceId);
    });
    videoPoolRef.current.forEach((el, sourceId) => {
      if (isPlaying && activeVideoSourceIds.has(sourceId)) {
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    });

    const activeAudioSourceIds = new Set();
    audioLanes.forEach((laneClips) => {
      const activeAudio = findActiveAudioInLane(laneClips, currentTime);
      if (activeAudio) activeAudioSourceIds.add(activeAudio.clip.sourceId);
    });
    audioPoolRef.current.forEach((el, sourceId) => {
      if (isPlaying && activeAudioSourceIds.has(sourceId)) {
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    });
  }, [isPlaying, currentTime, videoLanes, audioLanes]);

  // Browsers start every AudioContext 'suspended' until resumed from inside
  // a user gesture's call stack. The Play button's click handler flips
  // `isPlaying` synchronously, so resuming here - right as that state change
  // is applied - is as close to the gesture as a controlled-component hook
  // can get, and matches how every other autoplay-policy-constrained web app
  // handles this.
  useEffect(() => {
    if (isPlaying) audioCtxRef.current?.resume().catch(() => {});
  }, [isPlaying]);

  // Tear down pooled elements and the shared AudioContext on unmount.
  useEffect(() => () => {
    videoPoolRef.current.forEach((el) => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    });
    videoPoolRef.current.clear();
    audioPoolRef.current.forEach((el) => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    });
    audioPoolRef.current.clear();
    videoGainNodesRef.current.forEach((gain) => gain.disconnect());
    videoGainNodesRef.current.clear();
    audioGainNodesRef.current.forEach((gain) => gain.disconnect());
    audioGainNodesRef.current.clear();
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  return { videoDuration };
}

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { clipDuration, laneTotalDuration } from './transitions';
import { isVideoLikeClip, isImageClip } from './clipKinds';
import {
  groupLanes,
  findActiveInLane,
  findActiveAudioInLane,
  resolveClipGain,
  renderTimelineFrame,
  createCanvasPool,
} from './frameRenderer';

// Default canvas size (matches the pre-schema-v4 fixed 1080p/16:9 canvas) -
// used only as a fallback when no canvasSize is supplied. The real value
// comes from the project's own canvasSize (see usePersistedEditorState.js's
// defaultCanvasSize) and must agree with whatever the backend exporter
// renders to (see backend/routes/exportTimeline.js resolveCanvas) so the
// live preview and the exported file always frame identically.
const FALLBACK_CANVAS_SIZE = { width: 1920, height: 1080 };

// What a frame looks like (lanes, transforms, filters, transitions, text)
// is decided in timeline/frameRenderer.js, shared with the on-device
// export; this hook only supplies live frames from pooled <video>/<img>
// elements and drives playback and audio.

// Drives the Editor tab's live preview: composites pooled offscreen <video>
// elements (one per unique source near the playhead) and text overlays onto
// a <canvas>, driven by externally-controlled currentTime/isPlaying so it
// stays a plain controlled component from App.jsx's point of view. Since
// M8, every video/audio/text lane renders (not just lane 0) - video lanes
// stack in z-order for real picture-in-picture/overlays, audio lanes all
// mix together, text lanes all draw. Only lane 0's video defines the
// program's overall length (matches the backend export).
export function useTimelinePlayer({ timeline, currentTime, isPlaying, onTimeUpdate, onEnded, onClipDurationUpdate, canvasRef, trackMeta, canvasSize }) {
  const activeCanvasSize = canvasSize || FALLBACK_CANVAS_SIZE;
  const videoPoolRef = useRef(new Map());
  // Still images decode once into an <img> instead of a pooled <video> -
  // nothing to seek, play or wire into the audio graph, so they get their
  // own much simpler pool.
  const imagePoolRef = useRef(new Map());
  const audioPoolRef = useRef(new Map());
  const videoGainNodesRef = useRef(new Map());
  const audioGainNodesRef = useRef(new Map());
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const lastTickRef = useRef(null);
  const currentTimeRef = useRef(currentTime);
  const isPlayingRef = useRef(isPlaying);
  const reportedDurationsRef = useRef(new Map());
  // One reused offscreen canvas per clip id for chroma-key pixel processing
  // (see frameRenderer.js drawClipPicture) - avoids allocating a fresh canvas + backing store
  // every animation frame for any clip using chroma key.
  const chromaKeyCanvasPoolRef = useRef(new Map());
  const getChromaKeyCanvas = useCallback((clipId, width, height) => {
    let canvas = chromaKeyCanvasPoolRef.current.get(clipId);
    if (!canvas) {
      canvas = document.createElement('canvas');
      chromaKeyCanvasPoolRef.current.set(clipId, canvas);
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  }, []);
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

  // Memoized against `timeline` so drawFrame (below) only gets a new
  // identity when the timeline itself actually changes - without this,
  // every App re-render (e.g. from an unrelated state update elsewhere in
  // the tree) rebuilds these arrays, which cascades into the redraw and
  // play/pause-sync effects re-firing for no reason.
  const { videoClips, audioTrackClips, textClips, videoLanes, audioLanes, textLanes, laneZeroVideoClips, videoDuration } = useMemo(() => {
    // Adjustment layers (M13) live on video lanes for z-order (see
    // createAdjustmentClip) - grouped/drawn alongside real video clips here.
    // Image clips share the video lanes (and this whole pipeline) with
    // video clips - see timeline/clipKinds.js. Adjustment layers (M13) live
    // on video lanes for z-order (see createAdjustmentClip) and are grouped
    // and drawn alongside them here too.
    const videoClips = timeline.filter((clip) => isVideoLikeClip(clip) || clip.type === 'adjustment');
    const audioTrackClips = timeline.filter((clip) => clip.type === 'audio');
    const textClips = timeline.filter((clip) => clip.type === 'text');
    // A disabled clip (M11) still occupies its slot on the timeline - it
    // just renders nothing - so duration math below stays on the
    // unfiltered arrays and only the lane-building used for actually
    // drawing/playing excludes disabled clips.
    const videoLanes = groupLanes(videoClips.filter((clip) => clip.enabled !== false));
    const audioLanes = groupLanes(audioTrackClips.filter((clip) => clip.enabled !== false));
    const textLanes = groupLanes(textClips.filter((clip) => clip.enabled !== false));
    // The program's overall length is still lane 0's alone (matches the
    // backend, which only chains lane 0 into "the program" - see
    // backend/services/filterGraph/index.js); other lanes can run
    // shorter/longer without affecting playback bounds. Adjustment layers
    // never define the program length, same reasoning that already
    // excludes this from being driven by anything but real base video.
    const laneZeroVideoClips = videoClips.filter((clip) => (clip.trackIndex || 0) === 0 && clip.type !== 'adjustment');
    const videoDuration = laneTotalDuration(laneZeroVideoClips, clipDuration);
    return { videoClips, audioTrackClips, textClips, videoLanes, audioLanes, textLanes, laneZeroVideoClips, videoDuration };
  }, [timeline]);

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

  // The image counterpart of getVideoElement: one decoded <img> per unique
  // source, redrawing once the bitmap is actually available (the same
  // problem getVideoElement's 'loadeddata' listener solves - a paused
  // editor only redraws on React state changes, so without this an
  // imported image would show nothing until some unrelated re-render).
  const getImageElement = useCallback((clip) => {
    const pool = imagePoolRef.current;
    let el = pool.get(clip.sourceId);
    if (!el) {
      el = new Image();
      el.decoding = 'async';
      el.addEventListener('load', () => {
        if (!isPlayingRef.current) drawFrameRef.current(currentTimeRef.current);
      });
      pool.set(clip.sourceId, el);
    }
    if (clip.url && el.src !== clip.url) {
      el.src = clip.url;
    }
    return el;
  }, []);

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
    const activeImageSourceIds = new Set(videoClips.filter(isImageClip).map((clip) => clip.sourceId));
    for (const sourceId of imagePoolRef.current.keys()) {
      if (!activeImageSourceIds.has(sourceId)) imagePoolRef.current.delete(sourceId);
    }

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

    const activeClipIds = new Set(timeline.map((clip) => clip.id));
    for (const clipId of chromaKeyCanvasPoolRef.current.keys()) {
      if (!activeClipIds.has(clipId)) chromaKeyCanvasPoolRef.current.delete(clipId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  // Supplies the live frame for one active video entry (primary, or the
  // incoming clip during a transitionOut overlap): the pooled <video> (kept
  // near the playhead by seeking) or decoded <img>, or null while it isn't
  // ready yet. What gets drawn from it is decided by frameRenderer.js.
  const getPreviewSource = useCallback((entry) => {
    const { clip, localTime } = entry;
    const isStill = isImageClip(clip);
    const el = isStill ? getImageElement(clip) : getVideoElement(clip);

    if (!isStill && Number.isFinite(el.duration) && el.duration > 0) {
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
    // A still has nothing to seek - the same single bitmap serves every
    // frame of the clip, however it's trimmed, sped up or frozen.
    const seekThreshold = (clip.frozen || clip.reversed) ? 0.03 : 0.15;
    if (!isStill && el.readyState >= 1 && Math.abs(el.currentTime - localTime) > seekThreshold) {
      try {
        el.currentTime = Math.max(0, localTime);
      } catch { /* element not seekable yet */ }
    }

    const width = isStill ? el.naturalWidth : el.videoWidth;
    const height = isStill ? el.naturalHeight : el.videoHeight;
    const frameReady = isStill ? (el.complete && el.naturalWidth > 0) : el.readyState >= 2;
    return frameReady && width > 0 && height > 0 ? { image: el, width, height } : null;
  }, [getVideoElement, getImageElement, onClipDurationUpdate]);

  const scratchCanvasesRef = useRef(null);
  if (!scratchCanvasesRef.current) scratchCanvasesRef.current = createCanvasPool();

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
    if (canvas.width !== activeCanvasSize.width) canvas.width = activeCanvasSize.width;
    if (canvas.height !== activeCanvasSize.height) canvas.height = activeCanvasSize.height;
    renderTimelineFrame(canvas.getContext('2d'), canvas, time, {
      videoLanes,
      textLanes,
      trackMeta,
      getSource: getPreviewSource,
      fitMode: activeCanvasSize.fitMode,
      getChromaKeyCanvas,
      getScratchCanvas: scratchCanvasesRef.current,
    });
    updateAudioGains(time);
  }, [videoLanes, textLanes, getPreviewSource, updateAudioGains, canvasRef, trackMeta, activeCanvasSize, getChromaKeyCanvas]);

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
      // getPreviewSource drives both entirely via repeated seeks, which only
      // reads cleanly on a paused element (playing forward would fight the
      // seek every frame, and there's no native backward playback anyway).
      // A still image has no pooled <video> at all - nothing to play or
      // pause, so it's simply never a member of this set.
      const primaryPaused = active.primary.clip.frozen || active.primary.clip.reversed || isImageClip(active.primary.clip);
      if (!primaryPaused) activeVideoSourceIds.add(active.primary.clip.sourceId);
      if (active.next && !(active.next.clip.frozen || active.next.clip.reversed || isImageClip(active.next.clip))) {
        activeVideoSourceIds.add(active.next.clip.sourceId);
      }
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
    imagePoolRef.current.clear();
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

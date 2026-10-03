import {
  ALL_FORMATS,
  AudioBufferSource,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeVideo,
  getFirstEncodableAudioCodec,
} from 'mediabunny';
import { clipDuration, laneTotalDuration } from '../../timeline/transitions';
import { isImageClip, isVideoLikeClip } from '../../timeline/clipKinds';
import { buildSpeedSegments, hasSpeedCurve } from '../../timeline/speedCurve';
import { duckingGain, timeStretch } from './audioEffects';
import {
  createCanvasPool,
  findActiveInLane,
  groupLanes,
  renderTimelineFrame,
  resolveClipGain,
} from '../../timeline/frameRenderer';

// "Export on this device (beta)": renders the editor timeline in the browser
// instead of uploading it. Every frame is drawn by the same code as the live
// preview (timeline/frameRenderer.js) from exactly decoded source frames
// (WebCodecs through Mediabunny), the audio is mixed with an
// OfflineAudioContext following the server's rules, and the MP4 is encoded
// with the device's own H.264 encoder. The server export is untouched.
//
// Audio follows the server's rules: volume, keyframed volume, fades,
// crossfades under transitions, reversed and frozen clips, speed changes
// with the pitch kept (like atempo) and auto-duck (like sidechaincompress) -
// see audioEffects.js.

const AUDIO_RATE = 48000;
const AUDIO_BITRATE = 192_000;

function videoBitrate(width, height) {
  const longEdge = Math.max(width, height);
  if (longEdge <= 1280) return 5_000_000;
  if (longEdge <= 1920) return 8_000_000;
  if (longEdge <= 2560) return 12_000_000;
  return 20_000_000;
}

// What this browser can do for an export of this size.
export async function checkLocalExportSupport(width, height, fps) {
  if (typeof window === 'undefined' || typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return { ok: false, reason: 'This browser cannot process video on the device (no WebCodecs support). Use a recent Chrome, Edge, Firefox or Safari.' };
  }
  if (typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') {
    return { ok: false, reason: 'This browser cannot encode audio on the device. Use a recent Chrome, Edge, Firefox or Safari 26+.' };
  }
  const videoOk = await canEncodeVideo('avc', { width, height, bitrate: videoBitrate(width, height), frameRate: fps });
  if (!videoOk) {
    return { ok: false, reason: `This device cannot encode H.264 video at ${width}x${height}. Choose a smaller canvas size, or export on the server.` };
  }
  const audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: AUDIO_RATE, bitrate: AUDIO_BITRATE });
  if (!audioCodec) return { ok: false, reason: 'This browser cannot encode AAC or Opus audio on this device.' };
  return { ok: true, audioCodec };
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

// The program is lane 0's video, like the server (index.js) and preview.
export function programDuration(clips) {
  const laneZero = clips.filter((clip) => isVideoLikeClip(clip) && (clip.trackIndex || 0) === 0);
  return laneTotalDuration(laneZero, clipDuration);
}

// One opened source file per sourceId: the Mediabunny input with its tracks,
// or a decoded bitmap for a still image.
async function openSources(clips, signal) {
  const sources = new Map();
  for (const clip of clips) {
    if (!clip.sourceId || sources.has(clip.sourceId) || clip.type === 'text' || clip.type === 'adjustment') continue;
    assertNotAborted(signal);
    let blob = clip.file instanceof Blob ? clip.file : null;
    if (!blob && clip.url) {
      const response = await fetch(clip.url);
      if (!response.ok) throw new Error(`Could not read ${clip.fileName || clip.label || 'a clip'} - re-import it and try again.`);
      blob = await response.blob();
    }
    if (!blob) throw new Error(`${clip.fileName || clip.label || 'A clip'} is missing its file - re-import it and try again.`);

    if (isImageClip(clip)) {
      sources.set(clip.sourceId, { image: await createImageBitmap(blob) });
      continue;
    }
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const name = clip.fileName || clip.label || 'A clip';
    const videoTrack = clip.type === 'audio' ? null : await input.getPrimaryVideoTrack().catch(() => null);
    if (videoTrack && !(await videoTrack.canDecode())) {
      input.dispose();
      throw new Error(`${name} uses a video format (${(await videoTrack.getCodec()) || 'unknown'}) this browser cannot decode. Export on the server instead.`);
    }
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    const usableAudio = audioTrack && (await audioTrack.canDecode()) ? audioTrack : null;
    sources.set(clip.sourceId, {
      input,
      videoTrack,
      videoStart: videoTrack ? await videoTrack.getFirstTimestamp() : 0,
      audioTrack: usableAudio,
      audioStart: usableAudio ? await usableAudio.getFirstTimestamp() : 0,
    });
  }
  return sources;
}

// ---------------------------------------------------------------- audio
//
// The soundtrack is mixed and encoded a window at a time (AUDIO_WINDOW_SECONDS),
// in step with the video frames, so memory stays flat however long the
// program is - mixing all of it at once is ~4 GB for 3 hours of 48 kHz stereo.

const AUDIO_WINDOW_SECONDS = 20;

// Decoding starts this much early and the extra is dropped: an AAC frame
// decoded straight after a seek comes out partly silent (it's rebuilt with
// the frame before it), which would click at every window seam.
const DECODE_PREROLL_SECONDS = 0.1;

// [from, to) seconds of a source's audio at its own rate (up to 2 channels).
async function decodeRange(source, from, to, signal) {
  const track = source.audioTrack;
  const rate = track.sampleRate;
  const channels = Math.max(1, Math.min(2, track.numberOfChannels));
  const length = Math.max(1, Math.round((to - from) * rate));
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  if (!source.audioSink) source.audioSink = new AudioSampleSink(track);
  const decodeFrom = source.audioStart + Math.max(0, from - DECODE_PREROLL_SECONDS);
  for await (const sample of source.audioSink.samples(decodeFrom, source.audioStart + to)) {
    assertNotAborted(signal);
    const buffer = sample.toAudioBuffer();
    const offset = Math.round((sample.timestamp - source.audioStart - from) * rate);
    for (let c = 0; c < channels; c += 1) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      const start = Math.max(0, -offset);
      const count = Math.min(src.length - start, length - Math.max(0, offset));
      if (count > 0) data[c].set(src.subarray(start, start + count), Math.max(0, offset));
    }
    sample.close();
  }
  return { data, rate };
}

// The parts of a clip in its own output time, each with the source range
// and speed it plays at. A speed curve plays its segments in order and
// isn't reversed (the server's applyAudioSpeedCurve); a frozen clip's
// audio plays on, like the server's.
function clipAudioParts(clip) {
  if (hasSpeedCurve(clip)) {
    let at = 0;
    return buildSpeedSegments(clip).map((seg) => {
      const speed = seg.speed || 1;
      const part = { outStart: at, outEnd: at + (seg.sourceEnd - seg.sourceStart) / speed, srcStart: clip.trimmedStart + seg.sourceStart, srcEnd: clip.trimmedStart + seg.sourceEnd, speed, reversed: false };
      at = part.outEnd;
      return part;
    });
  }
  return [{ outStart: 0, outEnd: clipDuration(clip), srcStart: clip.trimmedStart, srcEnd: clip.trimmedEnd, speed: clip.speed || 1, reversed: Boolean(clip.reversed) }];
}

// How loud a clip is at output time `t`: its own volume/keyframes/fades
// times, for video clips, its share of a transition crossfade.
function clipGainAt(clip, t, lanes) {
  const duration = clipDuration(clip);
  const local = t - clip.startTime;
  if (local < 0 || local > duration) return 0;
  let mix = 1;
  if (clip.type !== 'audio') {
    const lane = lanes.get(clip.trackIndex || 0) || [];
    const active = findActiveInLane(lane, Math.min(t, clip.startTime + duration - 1e-4));
    if (active?.primary.clip.id === clip.id) mix = active.next ? 1 - active.progress : 1;
    else if (active?.next?.clip.id === clip.id) mix = active.progress;
    else mix = 0;
  }
  return resolveClipGain(clip, local, duration, { allowReversed: true }) * mix;
}

// The given clips mixed for program samples [s0, s1): each clip's piece in
// the window, reversed and time-stretched (pitch kept, like atempo) as
// needed, under its volume envelope.
async function renderAudioWindow(clips, sources, s0, s1, videoLanes, signal) {
  const t0 = s0 / AUDIO_RATE;
  const t1 = s1 / AUDIO_RATE;
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, s1 - s0), sampleRate: AUDIO_RATE });
  for (const clip of clips) {
    const source = sources.get(clip.sourceId);
    for (const part of clipAudioParts(clip)) {
      const a = Math.max(part.outStart, t0 - clip.startTime);
      const b = Math.min(part.outEnd, t1 - clip.startTime);
      if (b - a <= 0.0005) continue;
      const srcFrom = part.reversed ? part.srcEnd - (b - part.outStart) * part.speed : part.srcStart + (a - part.outStart) * part.speed;
      const srcTo = part.reversed ? part.srcEnd - (a - part.outStart) * part.speed : part.srcStart + (b - part.outStart) * part.speed;
      const { data, rate } = await decodeRange(source, Math.max(0, srcFrom), Math.max(0, srcTo), signal);
      if (part.reversed) data.forEach((channel) => channel.reverse());
      const channels = Math.abs(part.speed - 1) > 0.001 ? timeStretch(data, part.speed, rate) : data;
      const buffer = new AudioBuffer({ length: Math.max(1, channels[0].length), numberOfChannels: channels.length, sampleRate: rate });
      channels.forEach((channel, c) => buffer.copyToChannel(channel, c));

      const node = context.createBufferSource();
      node.buffer = buffer;
      const gain = context.createGain();
      node.connect(gain).connect(context.destination);
      const at = clip.startTime + a - t0;
      const span = b - a;
      // Volume envelope sampled every 10 ms.
      const step = 0.01;
      const steps = Math.max(2, Math.ceil(span / step) + 1);
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i += 1) curve[i] = clipGainAt(clip, clip.startTime + Math.min(b, a + i * step), videoLanes);
      gain.gain.setValueAtTime(curve[0], at);
      gain.gain.setValueCurveAtTime(curve, at, Math.max(0.01, (steps - 1) * step));
      node.start(at);
      node.stop(at + span);
    }
  }
  return context.startRendering();
}

function duckAmount(clip) {
  if (clip.type !== 'audio' || !clip.duck?.enabled) return 0;
  return typeof clip.duck.amount === 'number' ? clip.duck.amount : 70;
}

// The program's soundtrack, one window per call (window k = samples
// [k * size, (k + 1) * size)). Auto-duck, like the server: every ducked
// music/voice clip is lowered by a sidechain compressor listening to
// everything else; its state carries from one window to the next.
function createAudioMixer(clips, sources, duration, signal) {
  const totalSamples = Math.max(1, Math.ceil(duration * AUDIO_RATE));
  const videoLanes = new Map(groupLanes(clips.filter((clip) => isVideoLikeClip(clip))).map((lane) => [lane[0]?.trackIndex || 0, lane]));
  const sounding = clips.filter((clip) => (clip.type === 'audio' || (isVideoLikeClip(clip) && !isImageClip(clip)))
    && !clip.muted
    && clip.startTime < duration
    && sources.get(clip.sourceId)?.audioTrack);
  const ducked = sounding.filter((clip) => duckAmount(clip) > 0);
  const others = sounding.filter((clip) => !ducked.includes(clip));
  const duckStates = new Map(ducked.map((clip) => [clip.id, { linSlope: 0 }]));
  const windowSamples = AUDIO_WINDOW_SECONDS * AUDIO_RATE;
  const inWindow = (clip, t0, t1) => clip.startTime < t1 && clip.startTime + clipDuration(clip) > t0;

  return {
    windowCount: Math.ceil(totalSamples / windowSamples),
    windowSeconds: AUDIO_WINDOW_SECONDS,
    async window(k) {
      const s0 = k * windowSamples;
      const s1 = Math.min(totalSamples, s0 + windowSamples);
      const t0 = s0 / AUDIO_RATE;
      const t1 = s1 / AUDIO_RATE;
      const main = await renderAudioWindow(others.filter((clip) => inWindow(clip, t0, t1)), sources, s0, s1, videoLanes, signal);
      if (!ducked.length) return main;
      const trigger = [main.getChannelData(0), main.getChannelData(1)];
      const mixed = [new Float32Array(trigger[0]), new Float32Array(trigger[1])];
      for (const clip of ducked) {
        const state = duckStates.get(clip.id);
        if (!inWindow(clip, t0, t1)) {
          // Keep the compressor's memory moving through windows it's silent in.
          duckingGain(trigger, duckAmount(clip), AUDIO_RATE, state);
          continue;
        }
        const alone = await renderAudioWindow([clip], sources, s0, s1, videoLanes, signal);
        const gains = duckingGain(trigger, duckAmount(clip), AUDIO_RATE, state);
        for (let c = 0; c < 2; c += 1) {
          const data = alone.getChannelData(c);
          for (let n = 0; n < data.length; n += 1) mixed[c][n] += data[n] * gains[n];
        }
      }
      const result = new AudioBuffer({ length: s1 - s0, numberOfChannels: 2, sampleRate: AUDIO_RATE });
      mixed.forEach((channel, c) => result.copyToChannel(channel, c));
      return result;
    },
  };
}

// ---------------------------------------------------------------- video

// Which source frame every clip needs for every output frame, in order, so
// each clip's frames can be decoded as one forward-running stream.
function planFrames(videoLanes, totalFrames, fps) {
  const timestampsByClip = new Map();
  const frames = [];
  for (let i = 0; i < totalFrames; i += 1) {
    const time = i / fps;
    const needs = [];
    videoLanes.forEach((lane) => {
      const active = findActiveInLane(lane, time);
      if (!active) return;
      [active.primary, active.next].forEach((entry) => {
        if (!entry || entry.clip.type === 'adjustment' || isImageClip(entry.clip)) return;
        const list = timestampsByClip.get(entry.clip.id) || [];
        list.push(Math.max(0, entry.localTime));
        timestampsByClip.set(entry.clip.id, list);
        needs.push(entry.clip.id);
      });
    });
    frames.push(needs);
  }
  return { frames, timestampsByClip };
}

function drawWatermark(ctx, width, height) {
  const size = Math.round(height * 0.035);
  ctx.save();
  ctx.font = `${size}px Arial, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeText('NexEditor Free', width - 16, height - 16);
  ctx.fillText('NexEditor Free', width - 16, height - 16);
  ctx.restore();
}

async function loadFonts(textClips) {
  if (!document.fonts?.load) return;
  const loads = textClips.map((clip) => {
    const weight = clip.text?.caption?.weight || 700;
    const size = clip.text?.fontSize || 64;
    const family = clip.text?.caption ? 'Inter' : (clip.text?.fontFamily || 'Inter');
    return document.fonts.load(`${weight} ${size}px ${family}`).catch(() => {});
  });
  await Promise.all(loads);
  await document.fonts.ready;
}

// Where the finished MP4 is written. `saveTo`:
//   { handle }  - a file the user picked (Chrome/Edge's "save as"): written
//                 straight into it, nothing kept in memory;
//   { browser } - a file in the browser's own disk storage (OPFS, every
//                 modern browser), downloaded from there afterwards;
//   nothing     - in memory, fine for short videos.
async function openOutputTarget(saveTo) {
  if (saveTo?.handle) {
    const writable = await saveTo.handle.createWritable();
    return {
      target: new StreamTarget(writable, { chunked: true }),
      finish: async () => ({ file: await saveTo.handle.getFile(), savedTo: 'picked' }),
      discard: async () => {},
    };
  }
  if (saveTo?.browser) {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(saveTo.browser, { create: true });
    const writable = await handle.createWritable();
    return {
      target: new StreamTarget(writable, { chunked: true }),
      finish: async () => ({ file: await handle.getFile(), savedTo: 'browser' }),
      discard: async () => { await root.removeEntry(saveTo.browser).catch(() => {}); },
    };
  }
  return {
    target: new BufferTarget(),
    finish: async (output) => ({ file: new Blob([output.target.buffer], { type: 'video/mp4' }), savedTo: 'memory' }),
    discard: async () => {},
  };
}

// Whether long exports can be written to disk in this browser at all.
export function canStreamExportToDisk() {
  return typeof window !== 'undefined'
    && (typeof window.showSaveFilePicker === 'function' || typeof navigator.storage?.getDirectory === 'function');
}

// Earlier exports left in the browser's storage (they're downloaded right
// away, then only kept for "Download again").
export async function clearBrowserStoredExports() {
  try {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) {
      if (name.startsWith('nexeditor-export-')) await root.removeEntry(name).catch(() => {});
    }
  } catch { /* no browser file storage here */ }
}

// clips: the exportable timeline (hidden lanes and disabled clips already
// removed). canvas: the project's {width, height, fps, fitMode}; output:
// the size to encode (smaller for the free plan); watermark: free plan;
// saveTo: see openOutputTarget.
export async function exportTimelineLocally({ clips, trackMeta, canvas, output, watermark, audioCodec, saveTo, onProgress, signal }) {
  const report = (percent, stage) => onProgress?.({ percent: Math.max(0, Math.min(100, percent)), currentTime: stage });
  const fps = canvas.fps || 30;
  const duration = programDuration(clips);
  if (!(duration > 0)) throw new Error('Add at least one clip to the base video track before exporting.');
  const totalFrames = Math.max(1, Math.round(duration * fps));

  let sources = new Map();
  let exportOutput = null;
  let destination = null;
  const iterators = [];
  try {
    report(0, 'Reading your media...');
    sources = await openSources(clips, signal);

    const textClips = clips.filter((clip) => clip.type === 'text');
    await loadFonts(textClips);
    const videoLanes = groupLanes(clips.filter((clip) => isVideoLikeClip(clip) || clip.type === 'adjustment'));
    const textLanes = groupLanes(textClips);
    const clipsById = new Map(clips.map((clip) => [clip.id, clip]));

    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = canvas.width;
    renderCanvas.height = canvas.height;
    const renderCtx = renderCanvas.getContext('2d');
    const scaled = output.width !== canvas.width || output.height !== canvas.height;
    const encodeCanvas = scaled ? document.createElement('canvas') : renderCanvas;
    if (scaled) {
      encodeCanvas.width = output.width;
      encodeCanvas.height = output.height;
    }
    const encodeCtx = encodeCanvas.getContext('2d');
    const getScratchCanvas = createCanvasPool();
    const chromaPool = createCanvasPool();

    const mixer = createAudioMixer(clips, sources, duration, signal);
    destination = await openOutputTarget(saveTo);
    const videoSource = new CanvasSource(encodeCanvas, { codec: 'avc', bitrate: videoBitrate(output.width, output.height), keyFrameInterval: 2 });
    const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: AUDIO_BITRATE });
    // Written to disk as it goes, the file's index can't be kept in memory
    // to be put first at the end ('in-memory'); 'reserve' leaves room for it
    // at the start instead, sized from the known number of frames and audio
    // packets (AAC 1024 / Opus 960 samples each), so the MP4 still starts
    // playing (and uploads) straight away.
    const streaming = Boolean(saveTo?.handle || saveTo?.browser);
    const audioPackets = Math.ceil((duration * AUDIO_RATE) / 960) + 64;
    exportOutput = new Output({ format: new Mp4OutputFormat({ fastStart: streaming ? 'reserve' : 'in-memory' }), target: destination.target });
    exportOutput.addVideoTrack(videoSource, { frameRate: fps, ...(streaming ? { maximumPacketCount: totalFrames + 64 } : {}) });
    exportOutput.addAudioTrack(audioSource, streaming ? { maximumPacketCount: audioPackets } : {});
    await exportOutput.start();

    const { frames, timestampsByClip } = planFrames(videoLanes, totalFrames, fps);
    const streams = new Map();
    const streamFor = (clipId) => {
      if (!streams.has(clipId)) {
        const clip = clipsById.get(clipId);
        const source = sources.get(clip.sourceId);
        const sink = new CanvasSink(source.videoTrack, { poolSize: 4 });
        const timestamps = timestampsByClip.get(clipId).map((t) => source.videoStart + t);
        const iterator = sink.canvasesAtTimestamps(timestamps);
        iterators.push(iterator);
        streams.set(clipId, { iterator, last: null, remaining: timestamps.length });
      }
      return streams.get(clipId);
    };

    // Audio and video advance together, one audio window at a time, so
    // neither track runs ahead and piles up in memory.
    let frame = 0;
    for (let k = 0; k < mixer.windowCount; k += 1) {
      assertNotAborted(signal);
      await audioSource.add(await mixer.window(k));
      const windowEnd = k === mixer.windowCount - 1 ? totalFrames : Math.min(totalFrames, Math.round((k + 1) * mixer.windowSeconds * fps));
      for (; frame < windowEnd; frame += 1) {
        assertNotAborted(signal);
        const time = frame / fps;
        const current = new Map();
        for (const clipId of frames[frame]) {
          const stream = streamFor(clipId);
          const { value } = await stream.iterator.next();
          if (value?.canvas) stream.last = value.canvas;
          if (stream.last) current.set(clipId, { image: stream.last, width: stream.last.width, height: stream.last.height });
          stream.remaining -= 1;
        }
        renderTimelineFrame(renderCtx, renderCanvas, time, {
          videoLanes,
          textLanes,
          trackMeta,
          fitMode: canvas.fitMode,
          exactColor: true,
          getChromaKeyCanvas: chromaPool,
          getScratchCanvas,
          getSource: (entry) => {
            if (isImageClip(entry.clip)) {
              const bitmap = sources.get(entry.clip.sourceId)?.image;
              return bitmap ? { image: bitmap, width: bitmap.width, height: bitmap.height } : null;
            }
            return current.get(entry.clip.id) || null;
          },
        });
        if (scaled) encodeCtx.drawImage(renderCanvas, 0, 0, output.width, output.height);
        if (watermark) drawWatermark(encodeCtx, output.width, output.height);
        await videoSource.add(frame / fps, 1 / fps);
        // A clip whose last frame has been used releases its decoder now.
        for (const clipId of frames[frame]) {
          const stream = streams.get(clipId);
          if (stream && stream.remaining === 0 && !stream.closed) {
            stream.closed = true;
            await stream.iterator.return?.();
          }
        }
        if (frame % 5 === 0) report(1 + (frame / totalFrames) * 97, `Rendering frame ${frame + 1} of ${totalFrames}`);
      }
    }
    audioSource.close();
    videoSource.close();

    report(99, 'Finishing the file...');
    await exportOutput.finalize();
    const { file, savedTo } = await destination.finish(exportOutput);
    report(100, 'Export complete');
    return { file, blob: file, savedTo, duration, size: file.size, width: output.width, height: output.height };
  } catch (error) {
    if (exportOutput && exportOutput.state !== 'finalized' && exportOutput.state !== 'canceled') {
      await exportOutput.cancel().catch(() => {});
    }
    await destination?.discard();
    throw error;
  } finally {
    iterators.forEach((iterator) => iterator.return?.().catch?.(() => {}));
    sources.forEach((source) => {
      source.input?.dispose();
      source.image?.close?.();
    });
  }
}

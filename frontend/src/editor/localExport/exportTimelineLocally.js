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

// The source audio a clip uses, [trimmedStart, trimmedEnd), as an AudioBuffer.
async function decodeClipAudio(source, clip, signal) {
  const track = source.audioTrack;
  const from = source.audioStart + Math.max(0, clip.trimmedStart);
  const to = source.audioStart + Math.max(clip.trimmedStart, clip.trimmedEnd);
  const rate = track.sampleRate;
  const channels = Math.max(1, Math.min(2, track.numberOfChannels));
  const length = Math.max(1, Math.round((to - from) * rate));
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  const sink = new AudioSampleSink(track);
  for await (const sample of sink.samples(from, to)) {
    assertNotAborted(signal);
    const buffer = sample.toAudioBuffer();
    const offset = Math.round((sample.timestamp - from) * rate);
    for (let c = 0; c < channels; c += 1) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      const start = Math.max(0, -offset);
      const count = Math.min(src.length - start, length - Math.max(0, offset));
      if (count > 0) data[c].set(src.subarray(start, start + count), Math.max(0, offset));
    }
    sample.close();
  }
  // Speed-curve clips aren't reversed on the server either (applyAudioSpeedCurve).
  if (clip.reversed && !hasSpeedCurve(clip)) data.forEach((channel) => channel.reverse());
  const audioBuffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: rate });
  data.forEach((channel, c) => audioBuffer.copyToChannel(channel, c));
  return audioBuffer;
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

// A clip's audio at its output speed with the pitch kept (like ffmpeg
// atempo): one stretch for a plain speed change, one per segment for a
// speed curve (the server's per-segment atempo + concat).
function stretchClipAudio(buffer, clip) {
  const rate = buffer.sampleRate;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let stretched;
  if (hasSpeedCurve(clip)) {
    const parts = buildSpeedSegments(clip).map((seg) => timeStretch(
      channels.map((channel) => channel.subarray(Math.round(seg.sourceStart * rate), Math.round(seg.sourceEnd * rate))),
      seg.speed || 1,
      rate,
    ));
    stretched = channels.map((_, c) => {
      const total = parts.reduce((sum, part) => sum + part[c].length, 0);
      const joined = new Float32Array(total);
      let offset = 0;
      parts.forEach((part) => { joined.set(part[c], offset); offset += part[c].length; });
      return joined;
    });
  } else {
    stretched = timeStretch(channels, clip.speed || 1, rate);
  }
  const result = new AudioBuffer({ length: Math.max(1, stretched[0].length), numberOfChannels: stretched.length, sampleRate: rate });
  stretched.forEach((channel, c) => result.copyToChannel(channel, c));
  return result;
}

// Places clips' prepared audio on the program timeline with their volume
// envelopes and renders the mix.
function renderMix(entries, length, videoLanes) {
  const context = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: AUDIO_RATE });
  entries.forEach(({ clip, buffer }) => {
    const outDuration = clipDuration(clip);
    const node = context.createBufferSource();
    node.buffer = buffer;
    const gain = context.createGain();
    node.connect(gain).connect(context.destination);
    // Volume envelope sampled every 10 ms.
    const step = 0.01;
    const steps = Math.max(2, Math.ceil(outDuration / step) + 1);
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i += 1) curve[i] = clipGainAt(clip, clip.startTime + Math.min(outDuration, i * step), videoLanes);
    gain.gain.setValueAtTime(curve[0], clip.startTime);
    gain.gain.setValueCurveAtTime(curve, clip.startTime, Math.max(0.01, (steps - 1) * step));
    node.start(clip.startTime);
    node.stop(clip.startTime + outDuration);
  });
  return context.startRendering();
}

function duckAmount(clip) {
  if (clip.type !== 'audio' || !clip.duck?.enabled) return 0;
  return typeof clip.duck.amount === 'number' ? clip.duck.amount : 70;
}

async function mixAudio(clips, sources, duration, signal) {
  const length = Math.max(1, Math.ceil(duration * AUDIO_RATE));
  const videoLanes = new Map(groupLanes(clips.filter((clip) => isVideoLikeClip(clip))).map((lane) => [lane[0]?.trackIndex || 0, lane]));

  const sounding = clips.filter((clip) => (clip.type === 'audio' || (isVideoLikeClip(clip) && !isImageClip(clip)))
    && !clip.muted
    && clip.startTime < duration
    && sources.get(clip.sourceId)?.audioTrack);

  const entries = [];
  for (const clip of sounding) {
    assertNotAborted(signal);
    // A frozen clip's audio plays on, like the server's.
    const decoded = await decodeClipAudio(sources.get(clip.sourceId), clip, signal);
    entries.push({ clip, buffer: stretchClipAudio(decoded, clip) });
  }

  // Auto-duck, like the server: every ducked music/voice clip is lowered by
  // a sidechain compressor listening to everything else (the other clips'
  // audio and the non-ducked tracks).
  const ducked = entries.filter(({ clip }) => duckAmount(clip) > 0);
  const others = entries.filter((entry) => !ducked.includes(entry));
  const main = await renderMix(others, length, videoLanes);
  if (!ducked.length) return main;

  const trigger = [main.getChannelData(0), main.getChannelData(1)];
  const mixed = [new Float32Array(trigger[0]), new Float32Array(trigger[1])];
  for (const entry of ducked) {
    assertNotAborted(signal);
    const alone = await renderMix([entry], length, videoLanes);
    const gains = duckingGain(trigger, duckAmount(entry.clip), AUDIO_RATE);
    for (let c = 0; c < 2; c += 1) {
      const data = alone.getChannelData(c);
      for (let n = 0; n < length; n += 1) mixed[c][n] += data[n] * gains[n];
    }
  }
  const result = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: AUDIO_RATE });
  mixed.forEach((channel, c) => result.copyToChannel(channel, c));
  return result;
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

// clips: the exportable timeline (hidden lanes and disabled clips already
// removed). canvas: the project's {width, height, fps, fitMode}; output:
// the size to encode (smaller for the free plan); watermark: free plan.
export async function exportTimelineLocally({ clips, trackMeta, canvas, output, watermark, audioCodec, onProgress, signal }) {
  const report = (percent, stage) => onProgress?.({ percent: Math.max(0, Math.min(100, percent)), currentTime: stage });
  const fps = canvas.fps || 30;
  const duration = programDuration(clips);
  if (!(duration > 0)) throw new Error('Add at least one clip to the base video track before exporting.');
  const totalFrames = Math.max(1, Math.round(duration * fps));

  let sources = new Map();
  let exportOutput = null;
  const iterators = [];
  try {
    report(0, 'Reading your media...');
    sources = await openSources(clips, signal);

    report(1, 'Mixing the audio...');
    const mixed = await mixAudio(clips, sources, duration, signal);
    assertNotAborted(signal);

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

    const videoSource = new CanvasSource(encodeCanvas, { codec: 'avc', bitrate: videoBitrate(output.width, output.height), keyFrameInterval: 2 });
    const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: AUDIO_BITRATE });
    exportOutput = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    exportOutput.addVideoTrack(videoSource, { frameRate: fps });
    exportOutput.addAudioTrack(audioSource);
    await exportOutput.start();
    const audioDone = audioSource.add(mixed).then(() => audioSource.close());

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

    for (let i = 0; i < totalFrames; i += 1) {
      assertNotAborted(signal);
      const time = i / fps;
      const current = new Map();
      for (const clipId of frames[i]) {
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
      await videoSource.add(i / fps, 1 / fps);
      // A clip whose last frame has been used releases its decoder now.
      for (const clipId of frames[i]) {
        const stream = streams.get(clipId);
        if (stream && stream.remaining === 0 && !stream.closed) {
          stream.closed = true;
          await stream.iterator.return?.();
        }
      }
      if (i % 5 === 0) report(2 + (i / totalFrames) * 95, `Rendering frame ${i + 1} of ${totalFrames}`);
    }
    videoSource.close();

    report(97, 'Adding the audio...');
    await audioDone;
    report(99, 'Finishing the file...');
    await exportOutput.finalize();
    const blob = new Blob([exportOutput.target.buffer], { type: 'video/mp4' });
    report(100, 'Export complete');
    return { blob, duration, size: blob.size, width: output.width, height: output.height };
  } catch (error) {
    if (exportOutput && exportOutput.state !== 'finalized' && exportOutput.state !== 'canceled') {
      await exportOutput.cancel().catch(() => {});
    }
    throw error;
  } finally {
    iterators.forEach((iterator) => iterator.return?.().catch?.(() => {}));
    sources.forEach((source) => {
      source.input?.dispose();
      source.image?.close?.();
    });
  }
}

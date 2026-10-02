import {
  ALL_FORMATS,
  AudioBufferSource,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
} from 'mediabunny';
import API_BASE_URL from '../../config';
import { clipDuration } from '../../timeline/transitions';
import { isImageClip, isVideoLikeClip } from '../../timeline/clipKinds';
import { buildSpeedSegments, hasSpeedCurve } from '../../timeline/speedCurve';
import { timeStretch } from '../../editor/localExport/audioEffects';

// Auto captions without uploading the video, built for long recordings
// (1-3 hours): the timeline's speech is read from the user's own files a
// window at a time, mixed down to 16 kHz mono (all a speech model uses),
// cut at a pause near every 5 minutes so no word is split, compressed to
// ~1 MB and sent to /api/editor/captions/chunk. Each answer's word times
// are shifted onto the timeline.
//
// The job is resumable: `state` ({ cursor, words, language }) is updated
// after every piece, so a dropped connection or a full transcription quota
// never loses finished work - calling again with the same state continues.

const RATE = 16000;
// 5 minutes per request: small enough that if the speech model loses its
// way (it can, on long stretches) only a short part is affected, large
// enough that a 3-hour recording is still only ~36 requests.
const TARGET_CHUNK_SECONDS = 300;
const PAUSE_SEARCH_SECONDS = 20; // look this far either side of the target for a pause
const SILENT_RMS = 1e-4;

class UnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.code = 'UNSUPPORTED';
  }
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('Captions cancelled.', 'AbortError');
}

function wait(seconds, signal, onTick) {
  return new Promise((resolve, reject) => {
    let left = Math.ceil(seconds);
    onTick?.(left);
    const timer = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(timer);
        reject(new DOMException('Captions cancelled.', 'AbortError'));
        return;
      }
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        resolve();
      } else {
        onTick?.(left);
      }
    }, 1000);
  });
}

// Clips whose sound is part of the timeline (the caller has already dropped
// hidden lanes and disabled clips).
export function soundingClips(clips) {
  return clips.filter((clip) => (clip.type === 'audio' || (isVideoLikeClip(clip) && !isImageClip(clip))) && !clip.muted && clip.sourceId);
}

export function captionedDuration(clips) {
  return soundingClips(clips).reduce((max, clip) => Math.max(max, (clip.startTime || 0) + clipDuration(clip)), 0);
}

// Changes whenever something that affects the audio does - a saved job is
// only resumed against the same timeline.
export function captionJobSignature(clips, language) {
  return JSON.stringify([language, soundingClips(clips).map((c) => [c.id, c.sourceId, c.startTime, c.trimmedStart, c.trimmedEnd, c.speed || 1, Boolean(c.reversed), c.keyframes?.speed || []])]);
}

async function pickEncoding() {
  if (typeof AudioEncoder !== 'undefined') {
    const options = { numberOfChannels: 1, sampleRate: RATE, bitrate: 32_000 };
    if (await canEncodeAudio('opus', options)) return { codec: 'opus', bitrate: 32_000, format: () => new WebMOutputFormat(), mime: 'audio/webm', name: 'chunk.webm' };
    if (await canEncodeAudio('aac', options)) return { codec: 'aac', bitrate: 32_000, format: () => new Mp4OutputFormat(), mime: 'audio/mp4', name: 'chunk.m4a' };
  }
  // Uncompressed fallback: 5 minutes of 16 kHz mono 16-bit is ~10 MB,
  // under the transcription API's per-file limit.
  return { codec: 'pcm-s16', format: () => new WavOutputFormat(), mime: 'audio/wav', name: 'chunk.wav' };
}

async function openAudioSources(clips, signal) {
  const sources = new Map();
  for (const clip of clips) {
    if (sources.has(clip.sourceId)) continue;
    assertNotAborted(signal);
    let blob = clip.file instanceof Blob ? clip.file : null;
    if (!blob && clip.url) {
      const response = await fetch(clip.url);
      if (!response.ok) throw new Error(`Could not read ${clip.fileName || 'a clip'} - re-import it and try again.`);
      blob = await response.blob();
    }
    if (!blob) throw new Error(`${clip.fileName || 'A clip'} is missing its file - re-import it and try again.`);
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (!track) {
      input.dispose();
      sources.set(clip.sourceId, null); // no sound in this file
      continue;
    }
    if (!(await track.canDecode())) {
      input.dispose();
      throw new UnsupportedError(`This browser cannot read the audio of ${clip.fileName || 'a clip'} (${(await track.getCodec()) || 'unknown format'}).`);
    }
    sources.set(clip.sourceId, { input, sink: new AudioSampleSink(track), start: await track.getFirstTimestamp() });
  }
  return sources;
}

// [from, to) seconds of a source file as 16 kHz mono. Samples are averaged
// into their 16 kHz slot as they are decoded, so memory stays small however
// long the file is.
async function decodeMono16k(source, from, to, signal) {
  const length = Math.max(1, Math.ceil((to - from) * RATE));
  const sum = new Float32Array(length);
  const count = new Uint16Array(length);
  for await (const sample of source.sink.samples(source.start + from, source.start + to)) {
    assertNotAborted(signal);
    const buffer = sample.toAudioBuffer();
    const frames = buffer.length;
    const sourceRate = buffer.sampleRate;
    const channelCount = buffer.numberOfChannels;
    const first = buffer.getChannelData(0);
    const second = channelCount > 1 ? buffer.getChannelData(1) : null;
    const offset = sample.timestamp - source.start - from;
    for (let i = 0; i < frames; i += 1) {
      const index = Math.floor((offset + i / sourceRate) * RATE);
      if (index < 0 || index >= length) continue;
      sum[index] += second ? (first[i] + second[i]) / 2 : first[i];
      count[index] += 1;
    }
    sample.close();
  }
  let previous = 0;
  for (let i = 0; i < length; i += 1) {
    if (count[i]) previous = sum[i] / count[i];
    sum[i] = previous; // (a source below 16 kHz holds its last value)
  }
  return sum;
}

// The parts of a clip in its own output time, each with the source range
// and speed it plays at.
function clipParts(clip) {
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

// The timeline's mixed speech for [t0, t1) as 16 kHz mono.
async function renderWindow(clips, sources, t0, t1, signal) {
  const out = new Float32Array(Math.max(1, Math.round((t1 - t0) * RATE)));
  for (const clip of clips) {
    const source = sources.get(clip.sourceId);
    if (!source) continue;
    const volume = Math.max(0, Math.min(2, typeof clip.volume === 'number' ? clip.volume : 1));
    if (!volume) continue;
    for (const part of clipParts(clip)) {
      // Overlap of this part with the window, in the clip's own time.
      const a = Math.max(part.outStart, t0 - clip.startTime);
      const b = Math.min(part.outEnd, t1 - clip.startTime);
      if (b - a <= 0.001) continue;
      const srcFrom = part.reversed ? part.srcEnd - (b - part.outStart) * part.speed : part.srcStart + (a - part.outStart) * part.speed;
      const srcTo = part.reversed ? part.srcEnd - (a - part.outStart) * part.speed : part.srcStart + (b - part.outStart) * part.speed;
      let piece = await decodeMono16k(source, Math.max(0, srcFrom), Math.max(0, srcTo), signal);
      if (part.reversed) piece.reverse();
      if (Math.abs(part.speed - 1) > 0.001) [piece] = timeStretch([piece], part.speed, RATE);
      const offset = Math.round((clip.startTime + a - t0) * RATE);
      const n = Math.min(piece.length, out.length - offset);
      for (let i = 0; i < n; i += 1) out[offset + i] += piece[i] * volume;
    }
  }
  return out;
}

// Where to end this piece: the quietest 0.4 s near the target length.
function findPause(pcm, chunkSeconds, searchSeconds) {
  const target = chunkSeconds * RATE;
  const from = Math.max(0, target - searchSeconds * RATE);
  const to = Math.min(pcm.length, target + searchSeconds * RATE);
  const span = Math.round(0.4 * RATE);
  const step = Math.round(0.05 * RATE);
  let best = Math.min(target, pcm.length);
  let bestEnergy = Infinity;
  for (let start = from; start + span <= to; start += step) {
    let energy = 0;
    for (let i = start; i < start + span; i += 8) energy += pcm[i] * pcm[i];
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = start + Math.round(span / 2);
    }
  }
  return best;
}

function rms(pcm) {
  // Every 16th sample is plenty for a whole piece; a single word is short
  // enough to read fully.
  const step = pcm.length > RATE * 5 ? 16 : 1;
  let total = 0;
  let count = 0;
  for (let i = 0; i < pcm.length; i += step) {
    total += pcm[i] * pcm[i];
    count += 1;
  }
  return Math.sqrt(total / Math.max(1, count));
}

async function encodeChunk(pcm, encoding) {
  const buffer = new AudioBuffer({ length: pcm.length, numberOfChannels: 1, sampleRate: RATE });
  buffer.copyToChannel(pcm, 0);
  const output = new Output({ format: encoding.format(), target: new BufferTarget() });
  const source = new AudioBufferSource(encoding.bitrate ? { codec: encoding.codec, bitrate: encoding.bitrate } : { codec: encoding.codec });
  output.addAudioTrack(source);
  await output.start();
  await source.add(buffer);
  source.close();
  await output.finalize();
  return new Blob([output.target.buffer], { type: encoding.mime });
}

// One piece to the server. Waits out a full transcription quota (however
// long the server says) and retries short network failures a few times.
async function transcribeChunk(blob, encoding, { language, signal, onWaiting }) {
  let failures = 0;
  for (;;) {
    assertNotAborted(signal);
    const form = new FormData();
    form.append('audio', blob, encoding.name);
    form.append('language', language);
    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/editor/captions/chunk`, { method: 'POST', credentials: 'include', body: form, signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      failures += 1;
      if (failures > 3) throw new Error('The connection to the server kept failing. Check your internet and resume.');
      await wait(5 * failures * failures, signal, (left) => onWaiting?.({ reason: 'connection', seconds: left }));
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    if (response.status === 429) {
      const seconds = Math.max(5, Number(data.retryAfter) || 60);
      await wait(seconds + 2, signal, (left) => onWaiting?.({ reason: data.code === 'TRANSCRIPTION_QUOTA' ? 'quota' : 'busy', seconds: left }));
      continue;
    }
    if (response.status === 401) throw new Error('Your session expired - sign in again, then resume the captions.');
    failures += 1;
    if (failures > 3) throw new Error(data.error || `Transcription failed (${response.status}).`);
    await wait(5 * failures * failures, signal, (left) => onWaiting?.({ reason: 'connection', seconds: left }));
  }
}

export function createCaptionJobState() {
  return { cursor: 0, words: [], language: null };
}

// onProgress({ phase: 'reading' | 'transcribing' | 'waiting', done, total,
// reason?, seconds? }) - `done`/`total` are seconds of the timeline.
// `chunkSeconds` is how much audio goes into one request (tests use less).
export async function transcribeTimelineOnDevice({ clips, language = 'auto', state = createCaptionJobState(), onProgress, signal, chunkSeconds = TARGET_CHUNK_SECONDS }) {
  const searchSeconds = Math.min(PAUSE_SEARCH_SECONDS, chunkSeconds / 3);
  if (typeof AudioDecoder === 'undefined') throw new UnsupportedError('This browser cannot read audio on the device.');
  const sounding = soundingClips(clips);
  if (!sounding.length) throw new Error('Add a video or audio clip with sound first.');
  const duration = captionedDuration(clips);
  const report = (phase, extra = {}) => onProgress?.({ phase, done: Math.min(state.cursor, duration), total: duration, ...extra });

  report('reading');
  const encoding = await pickEncoding();
  const sources = await openAudioSources(sounding, signal);
  try {
    if (![...sources.values()].some(Boolean)) throw new Error('None of the clips on the timeline has sound to caption.');
    while (state.cursor < duration - 0.05) {
      assertNotAborted(signal);
      report('reading');
      const windowEnd = Math.min(duration, state.cursor + chunkSeconds + searchSeconds);
      const pcm = await renderWindow(sounding, sources, state.cursor, windowEnd, signal);
      const reachesEnd = windowEnd >= duration - 0.05;
      const cut = reachesEnd ? pcm.length : findPause(pcm, chunkSeconds, searchSeconds);
      const piece = pcm.subarray(0, cut);
      const pieceStart = state.cursor;

      // A silent stretch isn't sent at all - it would only use up quota.
      if (rms(piece) > SILENT_RMS) {
        report('transcribing');
        const blob = await encodeChunk(piece, encoding);
        // No "previous words" prompt: measured on real speech, passing one
        // threw word timings off by seconds; without it they're accurate.
        const result = await transcribeChunk(blob, encoding, {
          language,
          signal,
          onWaiting: (info) => report('waiting', info),
        });
        // The model sometimes invents speech in silence ("Thank you." after
        // the talking stops). A word is kept only if it lies inside the
        // piece and the audio at its own time isn't silent.
        const pieceSeconds = piece.length / RATE;
        const quiet = Math.max(SILENT_RMS, rms(piece) * 0.02);
        (result.words || []).forEach((word) => {
          if (!(word.start < pieceSeconds - 0.02)) return;
          const from = Math.max(0, Math.floor((word.start - 0.1) * RATE));
          const to = Math.min(piece.length, Math.ceil((word.end + 0.1) * RATE));
          if (to > from && rms(piece.subarray(from, to)) < quiet) return;
          state.words.push({ text: word.text, start: +(word.start + pieceStart).toFixed(3), end: +(Math.min(word.end, pieceSeconds) + pieceStart).toFixed(3) });
        });
        if (result.language) state.language = result.language;
      }
      state.cursor = reachesEnd ? duration : pieceStart + cut / RATE;
      report('transcribing');
    }
    if (!state.words.length) throw new Error('No speech was found in the timeline audio.');
    return { words: state.words, language: state.language, duration };
  } finally {
    sources.forEach((source) => source?.input.dispose());
  }
}

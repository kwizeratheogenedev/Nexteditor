import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp3OutputFormat,
  Output,
  WavOutputFormat,
} from 'mediabunny';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import { planAudioMerge, readWavData, TARGET_SECONDS, wavHeader, writeStereo } from './plan.js';

// Makes one merged audio on the user's device. Both inputs are decoded into a
// single 8-minute PCM buffer, which stops decoding the second audio the moment
// it is full, so a long second audio costs no more than the part used. That
// gives the WAV within seconds; the MP3 is encoded from it afterwards, since
// that is the slow part and shouldn't hold back a finished audio.
// One worker runs per merge.

registerMp3Encoder();

const SAMPLE_RATES = [44100, 48000];

function openAudio(file) {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

async function readAudio(file) {
  const track = await openAudio(file).getPrimaryAudioTrack().catch(() => null);
  if (!track) throw new Error(`"${file.name}" has no audio this browser can read.`);
  return { track, duration: await track.computeDuration() };
}

async function run(conversion, name, onProgress) {
  if (!conversion.isValid) throw new Error(`This browser can't read "${name}". Try Chrome or Edge, or convert it to MP3 first.`);
  conversion.onProgress = onProgress;
  await conversion.execute();
}

// The browser's own decoder, read directly. Far quicker than a Conversion, so
// it's used whenever nothing needs resampling or mixing down.
async function decodeDirectly(track, pcm, at, onProgress) {
  let index = at;
  let left = new Float32Array(0);
  let right = left;
  for await (const sample of new AudioSampleSink(track).samples()) {
    const frames = sample.numberOfFrames;
    if (left.length < frames) {
      left = new Float32Array(frames);
      right = new Float32Array(frames);
    }
    sample.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
    if (sample.numberOfChannels > 1) sample.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
    index = writeStereo(pcm, index, left, sample.numberOfChannels > 1 ? right : left, frames);
    sample.close();
    onProgress((index - at) / (pcm.length - at));
    if (index >= pcm.length) break;
  }
  return index;
}

// Handles a different sample rate or more than two channels. `end` trims it
// to the part that's needed, with a second to spare since `pcm` makes the cut.
async function decodeWithConversion(file, pcm, at, sampleRate, end, onProgress) {
  const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input: openAudio(file),
    output,
    tracks: 'primary',
    video: { discard: true },
    audio: { codec: 'pcm-s16', numberOfChannels: 2, sampleRate, forceTranscode: true },
    trim: { start: 0, end },
    showWarnings: false,
  });
  await run(conversion, file.name, onProgress);
  const data = readWavData(output.target.buffer);
  const room = (pcm.length - at) * 2;
  new Uint8Array(pcm.buffer).set(data.subarray(0, Math.min(room, data.length)), at * 2);
  return at + (Math.min(room, data.length) / 2);
}

function decode({ track }, file, pcm, at, sampleRate, end, onProgress) {
  return track.sampleRate === sampleRate && track.numberOfChannels <= 2
    ? decodeDirectly(track, pcm, at, onProgress)
    : decodeWithConversion(file, pcm, at, sampleRate, end, onProgress);
}

async function encodeMp3(wav, onProgress) {
  const output = new Output({ format: new Mp3OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input: openAudio(wav),
    output,
    audio: { codec: 'mp3', bitrate: 320000, forceTranscode: true },
    showWarnings: false,
  });
  await run(conversion, 'the merged audio', onProgress);
  return new Blob([output.target.buffer], { type: 'audio/mpeg' });
}

async function merge(first, second) {
  const [firstAudio, secondAudio] = await Promise.all([readAudio(first), readAudio(second)]);
  const plan = planAudioMerge(firstAudio.duration, secondAudio.duration);
  if (plan.error) throw new Error(plan.error);

  // Keeps the first audio's sample rate when an MP3 can carry it.
  const rate = firstAudio.track.sampleRate;
  const sampleRate = SAMPLE_RATES.includes(rate) ? rate : 44100;
  const pcm = new Int16Array(TARGET_SECONDS * sampleRate * 2);
  const firstShare = firstAudio.duration / TARGET_SECONDS;
  const report = (progress) => self.postMessage({ type: 'progress', progress });

  const firstEnd = await decode(firstAudio, first, pcm, 0, sampleRate, firstAudio.duration, (p) => report(p * firstShare));
  const secondEnd = Math.min(plan.secondSeconds + 1, secondAudio.duration);
  const end = await decode(secondAudio, second, pcm, firstEnd, sampleRate, secondEnd, (p) => report(firstShare + (p * (1 - firstShare))));

  const audio = pcm.subarray(0, end);
  const wav = new Blob([wavHeader(audio.byteLength, sampleRate), audio], { type: 'audio/wav' });
  self.postMessage({ type: 'wav', wav });

  const mp3 = await encodeMp3(wav, (progress) => self.postMessage({ type: 'mp3-progress', progress }));
  self.postMessage({ type: 'done', mp3 });
}

self.onmessage = async ({ data: { first, second } }) => {
  try {
    await merge(first, second);
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || 'These audios could not be merged.' });
  }
};

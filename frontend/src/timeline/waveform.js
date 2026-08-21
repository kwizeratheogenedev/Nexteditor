// Client-side peak extraction for the timeline's audio waveform display -
// decodes each unique source once via the Web Audio API (no backend
// round-trip, reuses the same File/blob the app already has in memory or
// IndexedDB) and caches the result so repeated renders/trims of the same
// source just re-slice cached peaks instead of re-decoding.

const RESOLUTION_PER_SECOND = 40; // peak buckets per second of source audio - fine enough at any on-screen zoom level
const peaksCache = new Map(); // sourceId -> Promise<{ peaks: Float32Array, duration: number } | null>

let sharedAudioCtx = null;
function getAudioContext() {
  if (sharedAudioCtx) return sharedAudioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  sharedAudioCtx = new Ctor();
  return sharedAudioCtx;
}

// One peak per bucket = the loudest sample (averaged across channels) in
// that bucket - cheap and enough to draw a recognizable waveform shape.
function downsampleToPeaks(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const duration = audioBuffer.duration;
  const bucketCount = Math.max(1, Math.round(duration * RESOLUTION_PER_SECOND));
  const samplesPerBucket = Math.max(1, Math.floor(length / bucketCount));
  const channelData = [];
  for (let c = 0; c < channelCount; c += 1) channelData.push(audioBuffer.getChannelData(c));

  const peaks = new Float32Array(bucketCount);
  for (let b = 0; b < bucketCount; b += 1) {
    const start = b * samplesPerBucket;
    const end = Math.min(length, start + samplesPerBucket);
    let max = 0;
    for (let i = start; i < end; i += 1) {
      let sum = 0;
      for (let c = 0; c < channelCount; c += 1) sum += Math.abs(channelData[c][i]);
      const value = sum / channelCount;
      if (value > max) max = value;
    }
    peaks[b] = max;
  }
  return { peaks, duration };
}

async function decodeSource(clip) {
  const ctx = getAudioContext();
  if (!ctx) return null;
  let arrayBuffer;
  if (clip.file) {
    arrayBuffer = await clip.file.arrayBuffer();
  } else if (clip.url || clip.remoteUrl) {
    const response = await fetch(clip.url || clip.remoteUrl);
    arrayBuffer = await response.arrayBuffer();
  } else {
    return null;
  }
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  return downsampleToPeaks(audioBuffer);
}

// Returns a Promise for the clip's full-source peaks, cached by sourceId (not
// clip.id) so duplicate/split clips sharing a source reuse the same decode.
export function getWaveformForClip(clip) {
  const key = clip.sourceId || clip.id;
  if (!peaksCache.has(key)) {
    peaksCache.set(key, decodeSource(clip).catch(() => null));
  }
  return peaksCache.get(key);
}

// Slices the cached full-source peaks down to the clip's current trim window
// and resamples to `bucketCount` bars matching the rendered width.
export function sliceWaveform(waveform, trimmedStart, trimmedEnd, bucketCount) {
  const out = new Float32Array(bucketCount);
  if (!waveform || !waveform.peaks.length) return out;
  const { peaks, duration } = waveform;
  const startIdx = Math.max(0, Math.floor((trimmedStart / duration) * peaks.length));
  const endIdx = Math.min(peaks.length, Math.ceil((trimmedEnd / duration) * peaks.length));
  const sliceLen = Math.max(1, endIdx - startIdx);
  for (let b = 0; b < bucketCount; b += 1) {
    const idx = startIdx + Math.floor((b / bucketCount) * sliceLen);
    out[b] = peaks[Math.min(peaks.length - 1, Math.max(0, idx))];
  }
  return out;
}

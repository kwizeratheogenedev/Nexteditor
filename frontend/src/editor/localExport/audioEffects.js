// Audio processing the browser's audio engine doesn't provide, written to
// match what the server's ffmpeg does:
//   timeStretch - change speed but keep the pitch (ffmpeg atempo); plain
//                 playbackRate would raise/lower the pitch with the speed.
//   duckingGain - ffmpeg sidechaincompress, the "Auto-duck under other
//                 audio" option (backend/services/filterGraph/effects/
//                 ducking.js) - music dips while other audio plays.
// Both work on plain Float32Array channels so they can be tested directly.

// WSOLA (waveform-similarity overlap-add), the same family of method as
// atempo: 40 ms windows are copied from the input at the new rate, each
// nudged by up to +/-10 ms to where it best continues the previous one, and
// cross-faded 50/50 - so the waveform, and with it the pitch, is preserved.
export function timeStretch(channels, speed, sampleRate) {
  const inLength = channels[0]?.length || 0;
  if (!inLength || !(speed > 0) || Math.abs(speed - 1) < 0.001) return channels.map((c) => c.slice());
  const outLength = Math.max(1, Math.round(inLength / speed));
  const frame = Math.max(64, 2 * Math.round(sampleRate * 0.02));
  const hop = frame / 2;
  const tolerance = Math.round(sampleRate * 0.01);
  // sin^2 window: two copies at 50% overlap sum to exactly 1, and it's never
  // exactly zero, so dividing by the accumulated weight is always safe.
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i += 1) window[i] = Math.sin((Math.PI * (i + 0.5)) / frame) ** 2;

  // The search compares a mono mix, every 4th sample, at 2-sample steps
  // (then refined to 1) - fast enough for minutes of audio.
  const mono = new Float32Array(inLength);
  channels.forEach((channel) => { for (let i = 0; i < inLength; i += 1) mono[i] += channel[i] / channels.length; });
  const similarity = (a, b) => {
    let xy = 0;
    let yy = 0;
    for (let i = 0; i < frame; i += 4) {
      const y = mono[a + i] || 0;
      xy += y * (mono[b + i] || 0);
      yy += y * y;
    }
    return yy > 0 ? xy / Math.sqrt(yy) : 0;
  };

  const out = channels.map(() => new Float32Array(outLength + frame));
  const weight = new Float32Array(outLength + frame);
  const maxStart = Math.max(0, inLength - frame);
  let previous = 0;
  for (let k = 0; k * hop < outLength; k += 1) {
    const outPos = k * hop;
    let pos = Math.min(maxStart, Math.round(outPos * speed));
    if (k > 0) {
      const target = previous + hop;
      const lo = Math.max(0, pos - tolerance);
      const hi = Math.min(maxStart, pos + tolerance);
      if (target < inLength && hi >= lo) {
        let best = pos;
        let bestScore = -Infinity;
        for (let d = lo; d <= hi; d += 2) {
          const score = similarity(d, target);
          if (score > bestScore) { bestScore = score; best = d; }
        }
        for (let d = Math.max(lo, best - 1); d <= Math.min(hi, best + 1); d += 1) {
          const score = similarity(d, target);
          if (score > bestScore) { bestScore = score; best = d; }
        }
        pos = best;
      }
    }
    for (let i = 0; i < frame; i += 1) {
      const n = outPos + i;
      weight[n] += window[i];
      const src = pos + i;
      if (src >= inLength) continue;
      for (let c = 0; c < channels.length; c += 1) out[c][n] += channels[c][src] * window[i];
    }
    previous = pos;
  }
  return out.map((channel) => {
    const result = channel.subarray(0, outLength);
    for (let n = 0; n < outLength; n += 1) if (weight[n] > 1e-6) result[n] /= weight[n];
    return result;
  });
}

// ffmpeg sidechaincompress with the server's settings for `amount` (0-100):
// threshold = 0.3 * 0.02^a, ratio = 2 + 18a, attack 15 ms, release 300 ms,
// knee 2.82843, RMS detection, channels averaged. Returns the per-sample
// gain for the ducked audio, driven by `trigger` (everything else).
// `state` ({ linSlope }) carries the compressor's level from one call to the
// next, for audio processed a window at a time.
export function duckingGain(trigger, amount, sampleRate, state = { linSlope: 0 }) {
  const length = trigger[0]?.length || 0;
  const gains = new Float32Array(length).fill(1);
  const a = Math.max(0, Math.min(100, Number(amount) || 0)) / 100;
  if (!length || a <= 0) return gains;
  const threshold = 0.3 * 0.02 ** a;
  const ratio = 2 + a * 18;
  const knee = 2.82843;
  const attackCoeff = Math.min(1, 1 / ((15 * sampleRate) / 4000));
  const releaseCoeff = Math.min(1, 1 / ((300 * sampleRate) / 4000));

  const thres = Math.log(threshold);
  const linKneeStart = threshold / Math.sqrt(knee);
  const adjKneeStart = linKneeStart * linKneeStart;
  const kneeStart = Math.log(linKneeStart);
  const kneeStop = Math.log(threshold * Math.sqrt(knee));
  const compressedKneeStop = (kneeStop - thres) / ratio + thres;

  const hermite = (x, x0, x1, p0, p1, m0, m1) => {
    const width = x1 - x0;
    const t = (x - x0) / width;
    const mm0 = m0 * width;
    const mm1 = m1 * width;
    const ct2 = -3 * p0 - 2 * mm0 + 3 * p1 - mm1;
    const ct3 = 2 * p0 + mm0 - 2 * p1 + mm1;
    return ct3 * t * t * t + ct2 * t * t + mm0 * t + p0;
  };
  const outputGain = (linSlope) => {
    const slope = Math.log(linSlope) * 0.5; // RMS detection
    let gain = (slope - thres) / ratio + thres;
    if (knee > 1 && slope < kneeStop) {
      gain = hermite(slope, kneeStart, kneeStop, kneeStart, compressedKneeStop, 1, 1 / ratio);
    }
    return Math.exp(gain - slope);
  };

  let { linSlope } = state;
  const channels = trigger.length;
  for (let n = 0; n < length; n += 1) {
    let level = 0;
    for (let c = 0; c < channels; c += 1) level += Math.abs(trigger[c][n]);
    level /= channels;
    level *= level;
    linSlope += (level - linSlope) * (level > linSlope ? attackCoeff : releaseCoeff);
    if (linSlope > 0 && linSlope > adjKneeStart) gains[n] = outputGain(linSlope);
  }
  state.linSlope = linSlope;
  return gains;
}

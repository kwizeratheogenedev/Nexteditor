// Audio Merge: the first audio plays whole, then the second is cut (from its
// start, never sped up) to exactly the time left before the target length.
// Everything here is plain arithmetic on 16-bit stereo PCM, the format both
// audios are decoded to on the user's device (see mergeWorker.js).

export const TARGET_SECONDS = 8 * 60;
const BYTES_PER_FRAME = 4;

export function formatTime(seconds) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Returns { secondSeconds } - how much of the second audio to keep - or
// { error } when these two audios can't make the target length.
export function planAudioMerge(firstDuration, secondDuration, target = TARGET_SECONDS) {
  if (firstDuration >= target) {
    return { error: `The first audio is ${formatTime(firstDuration)}, so there is no room left for the second one. It must be shorter than ${formatTime(target)}.` };
  }
  const secondSeconds = target - firstDuration;
  if (secondDuration < secondSeconds) {
    return { error: `Together these audios are only ${formatTime(firstDuration + secondDuration)}. The second audio must be at least ${formatTime(secondSeconds)} to reach ${formatTime(target)}.` };
  }
  return { secondSeconds };
}

// Writes decoded float samples into the interleaved 16-bit `pcm`, starting at
// index `at`. Mono plays on both sides. Stops when `pcm` is full, which is what
// lands the join exactly on the target, and returns where it got to.
export function writeStereo(pcm, at, left, right, frames) {
  let index = at;
  for (let i = 0; i < frames && index < pcm.length; i += 1) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    pcm[index] = l * 32767;
    pcm[index + 1] = r * 32767;
    index += 2;
  }
  return index;
}

// The PCM inside a WAV file, wherever its data chunk sits.
export function readWavData(buffer) {
  const view = new DataView(buffer);
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') return new Uint8Array(buffer, offset + 8, Math.min(size, buffer.byteLength - offset - 8));
    offset += 8 + size + (size % 2);
  }
  throw new Error('No audio data found.');
}

export function wavHeader(dataBytes, sampleRate) {
  const view = new DataView(new ArrayBuffer(44));
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_FRAME, true);
  view.setUint16(32, BYTES_PER_FRAME, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  return view.buffer;
}

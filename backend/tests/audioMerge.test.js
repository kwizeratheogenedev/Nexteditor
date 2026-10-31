import test from 'node:test';
import assert from 'node:assert/strict';
import { extendFromMiddle, planAudioMerge, planExtend, readWavData, TARGET_SECONDS, wavHeader, writeStereo } from '../../frontend/src/audioMerge/plan.js';

test('the second audio is cut to exactly the time the first leaves', () => {
  assert.deepEqual(planAudioMerge(180, 400), { secondSeconds: 300 });
  assert.deepEqual(planAudioMerge(180, 300), { secondSeconds: 300 });
});

test('a first audio of 8 minutes or more leaves no room', () => {
  assert.match(planAudioMerge(TARGET_SECONDS, 100).error, /first audio is 8:00/);
  assert.match(planAudioMerge(600, 100).error, /first audio is 10:00/);
});

test('audios that cannot reach 8 minutes together are refused', () => {
  assert.match(planAudioMerge(180, 200).error, /only 6:20.*at least 5:00/);
});

test('extend works out how much to add to reach 8 minutes', () => {
  assert.deepEqual(planExtend(420), { addedSeconds: 60 });
  assert.deepEqual(planExtend(180), { addedSeconds: 300 });
});

test('an audio of 8 minutes or more has nothing to extend', () => {
  assert.match(planExtend(TARGET_SECONDS).error, /audio is 8:00/);
  assert.match(planExtend(600).error, /audio is 10:00/);
});

// A buffer of `total` samples holding the audio 1, 2, 3... for its first `end`.
function audioOf(end, total) {
  const pcm = new Int16Array(total);
  for (let i = 0; i < end; i += 1) pcm[i] = i + 1;
  return pcm;
}

test('the time needed is cut from the exact middle and played right after itself', () => {
  const pcm = audioOf(10, 12);
  assert.equal(extendFromMiddle(pcm, 10), 12);
  // Section 5,6 sits in the middle of 1-10. Start and ending are untouched.
  assert.deepEqual([...pcm], [1, 2, 3, 4, 5, 6, 5, 6, 7, 8, 9, 10]);
});

test('needing more than half the audio plays the middle half repeatedly', () => {
  const pcm = audioOf(8, 18);
  assert.equal(extendFromMiddle(pcm, 8), 18);
  // Middle half is 3-6. The last play is cut so the ending still lands exactly.
  assert.deepEqual([...pcm], [1, 2, 3, 4, 5, 6, 3, 4, 5, 6, 3, 4, 5, 6, 3, 4, 7, 8].slice(0, 18));
});

test('every extended audio ends on its own original ending, at exactly the target', () => {
  for (const [end, total] of [[10, 12], [8, 18], [6, 1000], [998, 1000], [100, 300], [4, 44]]) {
    const pcm = audioOf(end, total);
    assert.equal(extendFromMiddle(pcm, end), total);
    assert.equal(pcm[total - 1], end);
    assert.equal(pcm[0], 1);
  }
});

test('left and right stay on their own sides through the cut', () => {
  const pcm = new Int16Array(1000);
  for (let i = 0; i < 700; i += 2) {
    pcm[i] = 1;
    pcm[i + 1] = 2;
  }
  extendFromMiddle(pcm, 700);
  assert.ok(pcm.every((value, i) => value === (i % 2 === 0 ? 1 : 2)));
});

test('an audio that fills the buffer already is left alone', () => {
  const pcm = audioOf(4, 4);
  assert.equal(extendFromMiddle(pcm, 4), 4);
  assert.deepEqual([...pcm], [1, 2, 3, 4]);
});

test('an audio that decoded to nothing is refused', () => {
  assert.throws(() => extendFromMiddle(new Int16Array(4), 0), /No audio/);
});

test('samples are written side by side at 16-bit, clipping anything too loud', () => {
  const pcm = new Int16Array(4);
  const end = writeStereo(pcm, 0, new Float32Array([1, -2]), new Float32Array([-1, 0.5]), 2);
  assert.equal(end, 4);
  assert.deepEqual([...pcm], [32767, -32767, -32767, 16383]);
});

test('the second audio carries on from where the first stopped', () => {
  const pcm = new Int16Array(4);
  const left = new Float32Array([1]);
  const middle = writeStereo(pcm, 0, left, left, 1);
  assert.equal(writeStereo(pcm, middle, left, left, 1), 4);
  assert.deepEqual([...pcm], [32767, 32767, 32767, 32767]);
});

test('writing stops exactly when the 8-minute buffer is full', () => {
  const pcm = new Int16Array(4);
  const tooMuch = new Float32Array(10).fill(1);
  assert.equal(writeStereo(pcm, 0, tooMuch, tooMuch, 10), 4);
  assert.equal(writeStereo(pcm, 4, tooMuch, tooMuch, 10), 4);
});

test('a written WAV header leads straight to its audio', () => {
  const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const header = new Uint8Array(wavHeader(pcm.length, 44100));
  const file = new Uint8Array(header.length + pcm.length);
  file.set(header);
  file.set(pcm, header.length);
  assert.deepEqual([...readWavData(file.buffer)], [...pcm]);
});

test('the audio is found past any other chunks in a WAV', () => {
  const pcm = [9, 9, 9, 9];
  const extra = [...'LIST'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 0, 0, 0, 0]);
  const data = [...'data'].map((c) => c.charCodeAt(0)).concat([4, 0, 0, 0], pcm);
  const file = new Uint8Array([...new Uint8Array(12), ...extra, ...data]);
  assert.deepEqual([...readWavData(file.buffer)], pcm);
});

test('a file with no audio data is refused', () => {
  assert.throws(() => readWavData(new Uint8Array(20).buffer), /No audio data/);
});

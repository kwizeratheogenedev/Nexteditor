import test from 'node:test';
import assert from 'node:assert/strict';
import { planAudioMerge, readWavData, TARGET_SECONDS, wavHeader, writeStereo } from '../../frontend/src/audioMerge/plan.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioMergeArgs, MERGE_TARGET_SECONDS, planAudioMerge } from '../services/audioMerge.js';

test('the second audio is cut to exactly the time the first leaves', () => {
  assert.deepEqual(planAudioMerge(180, 400), { secondSeconds: 300 });
  assert.deepEqual(planAudioMerge(180, 300), { secondSeconds: 300 });
});

test('a first audio of 8 minutes or more leaves no room', () => {
  assert.match(planAudioMerge(MERGE_TARGET_SECONDS, 100).error, /first audio is 8:00/);
  assert.match(planAudioMerge(600, 100).error, /first audio is 10:00/);
});

test('audios that cannot reach 8 minutes together are refused', () => {
  assert.match(planAudioMerge(180, 200).error, /only 6:20.*at least 5:00/);
});

test('only the second input is trimmed, and the output is capped at the target', () => {
  const args = buildAudioMergeArgs('a.mp3', 'b.mp3', 300, { mp3Path: 'out.mp3', wavPath: 'out.wav' });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /^\[1:a:0\]atrim=duration=301\.000/);
  assert.doesNotMatch(filter, /\[0:a:0\][^;]*atrim/);
  assert.equal(args[args.indexOf('-t') + 1], '480');
  assert.equal(args[args.lastIndexOf('-t') + 1], '480');
});

test('one run writes both the MP3 and an uncompressed WAV', () => {
  const args = buildAudioMergeArgs('a.mp3', 'b.mp3', 300, { mp3Path: 'out.mp3', wavPath: 'out.wav' });
  assert.ok(args.indexOf('libmp3lame') < args.indexOf('out.mp3'));
  assert.ok(args.indexOf('out.mp3') < args.indexOf('pcm_s16le'));
  assert.equal(args.at(-1), 'out.wav');
});

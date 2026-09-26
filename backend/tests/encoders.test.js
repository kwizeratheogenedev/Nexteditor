import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncoderDetector, runWithEncoderFallback, videoEncoderArgs, getVideoEncoder } from '../services/encoders.js';
import { runFFmpeg } from '../services/ffmpeg.js';

const quietLog = { info() {}, warn() {}, error() {} };
const codecOf = (args) => args[args.indexOf('-c:v') + 1];

// A fake ffmpeg that "works" only for the listed encoders.
function fakeRun(working) {
  const calls = [];
  const run = async (args) => {
    calls.push(codecOf(args));
    if (!working.includes(codecOf(args))) throw new Error('Error while opening encoder');
  };
  return { run, calls };
}

test('auto picks the first hardware encoder that passes its test encode', async () => {
  const { run, calls } = fakeRun(['h264_qsv', 'h264_amf', 'libx264']);
  const detector = createEncoderDetector({ run, log: quietLog, env: {} });
  assert.equal(await detector.getVideoEncoder(), 'h264_qsv');
  assert.deepEqual(calls, ['h264_nvenc', 'h264_qsv'], 'stops at the first one that works');
  assert.equal(detector.current(), 'h264_qsv');
});

test('detection runs once and is reused', async () => {
  const { run, calls } = fakeRun(['h264_nvenc']);
  const detector = createEncoderDetector({ run, log: quietLog, env: {} });
  await detector.getVideoEncoder();
  await detector.getVideoEncoder();
  assert.equal(calls.length, 1);
});

test('no working hardware falls back to libx264', async () => {
  const { run } = fakeRun([]);
  const detector = createEncoderDetector({ run, log: quietLog, env: {} });
  assert.equal(await detector.getVideoEncoder(), 'libx264');
});

test('EXPORT_ENCODER=libx264 forces the CPU encoder without probing', async () => {
  const { run, calls } = fakeRun(['h264_nvenc']);
  const detector = createEncoderDetector({ run, log: quietLog, env: { EXPORT_ENCODER: 'libx264' } });
  assert.equal(await detector.getVideoEncoder(), 'libx264');
  assert.equal(calls.length, 0);
});

test('a forced encoder that fails its test, or an unknown name, falls back to libx264', async () => {
  const { run } = fakeRun([]);
  assert.equal(await createEncoderDetector({ run, log: quietLog, env: { EXPORT_ENCODER: 'h264_nvenc' } }).getVideoEncoder(), 'libx264');
  assert.equal(await createEncoderDetector({ run, log: quietLog, env: { EXPORT_ENCODER: 'made_up' } }).getVideoEncoder(), 'libx264');
});

test('libx264 args keep the existing preset/crf env overrides', () => {
  const before = { preset: process.env.EXPORT_ENCODE_PRESET, crf: process.env.EXPORT_CRF };
  process.env.EXPORT_ENCODE_PRESET = 'medium';
  process.env.EXPORT_CRF = '18';
  try {
    assert.deepEqual(videoEncoderArgs('libx264'), ['-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18']);
  } finally {
    if (before.preset === undefined) delete process.env.EXPORT_ENCODE_PRESET; else process.env.EXPORT_ENCODE_PRESET = before.preset;
    if (before.crf === undefined) delete process.env.EXPORT_CRF; else process.env.EXPORT_CRF = before.crf;
  }
});

test('a hardware encode that fails mid-export is retried once with libx264', async () => {
  const { run, calls } = fakeRun(['libx264']);
  await runWithEncoderFallback((v) => ['-y', ...v, 'out.mp4'], {}, { run, getEncoder: async () => 'h264_qsv', log: quietLog });
  assert.deepEqual(calls, ['h264_qsv', 'libx264']);
});

test('timeouts, cancellations and libx264 failures are not retried', async () => {
  const failing = (message) => async () => { throw new Error(message); };
  for (const [encoder, message] of [['h264_qsv', 'FFmpeg timeout exceeded (1000ms)'], ['h264_qsv', 'Render cancelled.'], ['libx264', 'boom']]) {
    let attempts = 0;
    const run = async (...a) => { attempts += 1; return failing(message)(...a); };
    await assert.rejects(
      runWithEncoderFallback((v) => v, {}, { run, getEncoder: async () => encoder, log: quietLog }),
      new RegExp(message.replace(/[().]/g, '\\$&')),
    );
    assert.equal(attempts, 1, `${encoder} / ${message}`);
  }
});

test('on this machine: detection picks a real encoder and a real export-style encode succeeds', async () => {
  const encoder = await getVideoEncoder();
  assert.ok(typeof encoder === 'string' && encoder.length > 0);
  await runWithEncoderFallback(
    (v) => ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=1', '-r', '30', ...v, '-f', 'null', '-'],
    { timeout: 30000 },
    { run: runFFmpeg },
  );
});

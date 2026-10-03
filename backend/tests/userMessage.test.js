import test from 'node:test';
import assert from 'node:assert/strict';
import { ffmpegError, toUserMessage } from '../services/userMessage.js';
import { holdFiles, isFileHeld } from '../services/fileLeases.js';

const RAW_MISSING = `ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/ Copyright (c) 2000-2024
[in#0 @ 0x2be13e00] Error opening input: No such file or directory
Error opening input file /opt/render/project/src/backend/uploads/8f8417f1-song montage.mp4.`;

test('a missing input file becomes a plain explanation, raw output kept for the log', () => {
  const error = ffmpegError(RAW_MISSING);
  assert.match(error.message, /no longer on the server/);
  assert.doesNotMatch(error.message, /ffmpeg|\/opt\//);
  assert.match(error.details, /Error opening input/);
  assert.equal(toUserMessage(error, 'fallback'), error.message);
});

test('damaged files and unknown ffmpeg failures get readable messages', () => {
  assert.match(ffmpegError('moov atom not found').message, /damaged/);
  assert.match(ffmpegError('something nobody expected').message, /couldn't be processed/);
});

test('technical text never reaches the user', () => {
  assert.equal(toUserMessage(new Error(RAW_MISSING), 'Try again.'), 'Try again.');
  assert.equal(toUserMessage(new TypeError("Cannot read properties of undefined (reading 'x')"), 'Try again.'), 'Try again.');
  const enoent = Object.assign(new Error("ENOENT: no such file or directory, open '/var/data/x'"), { code: 'ENOENT', syscall: 'open', errno: -2 });
  assert.match(toUserMessage(enoent, 'Try again.'), /no longer on the server/);
  const spawnFail = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT', syscall: 'spawn ffmpeg', errno: -2 });
  assert.equal(toUserMessage(spawnFail, 'Try again.'), 'Try again.');
});

test('our own plain messages pass through unchanged', () => {
  assert.equal(toUserMessage(new Error('At least 2 videos are required to create a montage'), 'x'), 'At least 2 videos are required to create a montage');
  assert.equal(toUserMessage(null, 'Fallback.'), 'Fallback.');
});

test('held files are protected until every holder releases them', () => {
  const releaseA = holdFiles(['/srv/uploads/a.mp4', '/srv/uploads/b.mp4']);
  const releaseB = holdFiles(['/srv/uploads/a.mp4']);
  assert.equal(isFileHeld('/srv/uploads/a.mp4'), true);
  releaseA();
  releaseA(); // a second call changes nothing
  assert.equal(isFileHeld('/srv/uploads/a.mp4'), true);
  assert.equal(isFileHeld('/srv/uploads/b.mp4'), false);
  releaseB();
  assert.equal(isFileHeld('/srv/uploads/a.mp4'), false);
});

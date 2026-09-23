import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createLogger } from '../services/logger.js';
import { requestLogger } from '../middleware/requestLog.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function capture() {
  const lines = { log: [], error: [] };
  return { lines, sink: { log: (l) => lines.log.push(l), error: (l) => lines.error.push(l) } };
}

test('logger writes one JSON object per line in json mode, with errors serialized', () => {
  const { lines, sink } = capture();
  const log = createLogger({ level: 'info', format: 'json', sink });
  log.error('render failed', { jobId: 'j1', err: new Error('ffmpeg exploded') });
  const entry = JSON.parse(lines.error[0]);
  assert.equal(entry.level, 'error');
  assert.equal(entry.msg, 'render failed');
  assert.equal(entry.jobId, 'j1');
  assert.equal(entry.err.message, 'ffmpeg exploded');
  assert.ok(entry.time);
});

test('logger respects the minimum level', () => {
  const { lines, sink } = capture();
  const log = createLogger({ level: 'warn', format: 'json', sink });
  log.debug('d');
  log.info('i');
  log.warn('w');
  assert.equal(lines.log.length, 0);
  assert.equal(lines.error.length, 1);
});

test('request logger tags requests, logs failures and writes, and skips polling', async () => {
  const entries = [];
  const log = { info: (m, c) => entries.push(['info', m, c]), warn: (m, c) => entries.push(['warn', m, c]), error: (m, c) => entries.push(['error', m, c]) };
  const app = express();
  app.use(requestLogger({ log }));
  app.get('/api/ok', (_q, r) => r.json({}));
  app.get('/api/x/progress/1', (_q, r) => r.json({}));
  app.post('/api/save', (_q, r) => r.json({}));
  app.get('/api/missing', (_q, r) => r.status(404).json({}));
  app.get('/api/boom', (_q, r) => r.status(500).json({}));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/ok`);
    assert.ok(res.headers.get('x-request-id'), 'every response carries a request id');
    await fetch(`${base}/api/x/progress/1`);
    await fetch(`${base}/api/save`, { method: 'POST' });
    await fetch(`${base}/api/missing`);
    await fetch(`${base}/api/boom`);
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    await new Promise((r) => server.close(r));
  }
  const summary = entries.map(([level, , ctx]) => `${level}:${ctx.method}:${ctx.url}:${ctx.status}`);
  assert.deepEqual(summary, ['info:POST:/api/save:200', 'warn:GET:/api/missing:404', 'error:GET:/api/boom:500']);
});

test('an unhandled rejection is logged and still stops the process by default', () => {
  const script = `
    import { installCrashHandlers } from './services/crashHandlers.js';
    installCrashHandlers();
    Promise.reject(new Error('lost promise'));
    setTimeout(() => console.log('STILL_RUNNING'), 600);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: backendDir, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unhandled promise rejection/);
  assert.match(result.stderr, /lost promise/);
  assert.doesNotMatch(result.stdout, /STILL_RUNNING/);
});

test('KEEP_ALIVE_ON_REJECTION=1 logs the rejection but keeps running', () => {
  const script = `
    import { installCrashHandlers } from './services/crashHandlers.js';
    installCrashHandlers();
    Promise.reject(new Error('lost promise'));
    setTimeout(() => console.log('STILL_RUNNING'), 300);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendDir, encoding: 'utf8', timeout: 15000, env: { ...process.env, KEEP_ALIVE_ON_REJECTION: '1' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Unhandled promise rejection/);
  assert.match(result.stdout, /STILL_RUNNING/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import Operation from '../models/Operation.js';
import { trackOperation, markInterruptedOperations } from '../services/operations.js';

// A stand-in database: records what would be written, writes nothing.
const created = [];
const updates = [];
Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
Operation.create = async (doc) => { created.push(doc); return { _id: `op${created.length}` }; };
Operation.updateOne = async (query, update) => { updates.push({ id: query._id, ...update.$set }); };

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function fakeRequest({ user = null, files } = {}) {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.writableFinished = false;
  res.json = (body) => body;
  res.status = (code) => { res.statusCode = code; return res; };
  const finish = () => { res.writableFinished = true; res.emit('finish'); res.emit('close'); };
  const req = { user, files };
  return { req, res, finish };
}

async function run(kind, options, respond) {
  const { req, res, finish } = fakeRequest(options);
  await new Promise((resolve) => trackOperation(kind)(req, res, resolve));
  await respond(req, res, finish);
  await settle();
  return req;
}

test('a guest merge that succeeds is recorded as done, with its upload size', async () => {
  created.length = 0; updates.length = 0;
  await run('merge', { files: { video1: [{ size: 1000 }], audio: [{ size: 500 }] } }, (_req, _res, finish) => finish());
  assert.deepEqual({ kind: created[0].kind, owner: created[0].owner, guest: created[0].guest, inputBytes: created[0].inputBytes }, { kind: 'merge', owner: null, guest: true, inputBytes: 1500 });
  assert.equal(updates[0].status, 'done');
  assert.equal(typeof updates[0].durationMs, 'number');
});

test("a rejected request is recorded as failed with the message the user saw", async () => {
  created.length = 0; updates.length = 0;
  await run('montage', { user: { _id: 'u1' } }, (_req, res, finish) => { res.status(400).json({ error: 'At least 2 videos are required' }); finish(); });
  assert.equal(created[0].owner, 'u1');
  assert.equal(created[0].guest, false);
  assert.deepEqual([updates[0].status, updates[0].error], ['error', 'At least 2 videos are required']);
});

test('a background job (202) is recorded when it reports its own end', async () => {
  created.length = 0; updates.length = 0;
  const req = await run('export', {}, (_req, res, finish) => { res.status(202).json({ jobId: 'j' }); finish(); });
  assert.equal(updates.length, 0, 'still running after the 202');
  req.operation.fail(Object.assign(new Error('One of your files is no longer on the server.'), { userFacing: true, details: 'raw ffmpeg text' }), { kind: 'longmix' });
  req.operation.done(); // ignored - the first ending wins
  await settle();
  assert.equal(updates.length, 1);
  assert.deepEqual([updates[0].status, updates[0].kind, updates[0].error, updates[0].errorDetails], ['error', 'longmix', 'One of your files is no longer on the server.', 'raw ffmpeg text']);
});

test('a dropped connection is recorded as failed', async () => {
  created.length = 0; updates.length = 0;
  await run('link-fetch', {}, (_req, res) => { res.emit('close'); });
  assert.equal(updates[0].status, 'error');
  assert.match(updates[0].error, /connection closed/);
});

test('work still running from before a restart is marked as failed', async () => {
  let query; let change;
  Operation.updateMany = async (q, u) => { query = q; change = u.$set; return { modifiedCount: 2 }; };
  const startedAt = new Date();
  await markInterruptedOperations(startedAt);
  assert.deepEqual(query, { status: 'running', createdAt: { $lt: startedAt } });
  assert.equal(change.status, 'error');
  assert.match(change.error, /restarted/);
});

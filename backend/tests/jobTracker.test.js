import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Job from '../models/Job.js';
import { upsertJob, removeJob } from '../services/jobTracker.js';

// A stand-in database where the first write is slow - the situation that
// used to let a job's "error" write land before its first write.
const writes = [];
let delays = [];
Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
Job.findOneAndUpdate = async (query, update, options) => {
  await new Promise((resolve) => setTimeout(resolve, delays.shift() ?? 0));
  writes.push({ status: update.$set.status, kind: update.$setOnInsert.kind, upsert: options.upsert });
};
Job.deleteOne = async () => { writes.push({ deleted: true }); };

test("a job's writes land in the order they were made, even when the first is slow", async () => {
  writes.length = 0;
  delays = [50, 0];
  upsertJob('u1', { jobId: 'j1', kind: 'montage', status: 'running' });
  await upsertJob('u1', { jobId: 'j1', status: 'error', error: 'One of your files is gone.' });
  assert.deepEqual(writes.map((w) => w.status), ['running', 'error']);
  assert.equal(writes[0].kind, 'montage');
});

test('only a write that knows the kind may create the record', async () => {
  writes.length = 0;
  delays = [];
  await upsertJob('u1', { jobId: 'j2', status: 'error' });
  await upsertJob('u1', { jobId: 'j3', kind: 'export', status: 'running' });
  assert.deepEqual(writes.map((w) => w.upsert), [false, true]);
});

test('a removal waits for the writes before it', async () => {
  writes.length = 0;
  delays = [30];
  upsertJob('u1', { jobId: 'j4', kind: 'montage', status: 'running' });
  await removeJob('u1', 'j4');
  assert.deepEqual(writes.map((w) => (w.deleted ? 'deleted' : w.status)), ['running', 'deleted']);
});

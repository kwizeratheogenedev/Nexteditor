import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiskGuard, getDiskStatus } from '../middleware/diskGuard.js';

const GB = 1024 * 1024 * 1024;

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function run(guard, { method = 'POST', type = 'multipart/form-data; boundary=x', length } = {}) {
  const req = { method, headers: { 'content-type': type, ...(length !== undefined ? { 'content-length': String(length) } : {}) } };
  const res = fakeRes();
  let passed = false;
  await guard(req, res, () => { passed = true; });
  return { passed, res };
}

const base = { minFreeBytes: 5 * GB, maxStorageBytes: 40 * GB };

test('lets uploads through when there is plenty of room', async () => {
  const guard = createDiskGuard({ ...base, freeBytes: async () => 100 * GB, dirSize: async () => 1 * GB });
  const { passed } = await run(guard, { length: 500 * 1024 * 1024 });
  assert.equal(passed, true);
});

test('blocks uploads with 503 when free disk is below the minimum', async () => {
  const guard = createDiskGuard({ ...base, freeBytes: async () => 4 * GB, dirSize: async () => 0 });
  const { passed, res } = await run(guard, { length: 1000 });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'SERVER_BUSY_DISK');
  assert.equal(res.headers['Retry-After'], '120');
});

test('counts the size of the incoming upload against free space', async () => {
  const guard = createDiskGuard({ ...base, freeBytes: async () => 6 * GB, dirSize: async () => 0 });
  const { passed } = await run(guard, { length: 2 * GB });
  assert.equal(passed, false, '6 GB free minus a 2 GB upload leaves less than the 5 GB reserve');
});

test('blocks when uploads + clips already exceed the storage cap', async () => {
  const guard = createDiskGuard({ ...base, freeBytes: async () => 500 * GB, dirSize: async () => 40 * GB });
  const { passed, res } = await run(guard, { length: 10 });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 503);
});

test('ignores anything that is not a multipart upload', async () => {
  const guard = createDiskGuard({ ...base, freeBytes: async () => 0, dirSize: async () => 999 * GB });
  assert.equal((await run(guard, { method: 'GET' })).passed, true);
  assert.equal((await run(guard, { type: 'application/json' })).passed, true);
});

test('fails open if the disk check itself throws', async () => {
  const guard = createDiskGuard({ ...base, freeBytes: async () => { throw new Error('statfs unsupported'); }, dirSize: async () => 0 });
  const { passed } = await run(guard);
  assert.equal(passed, true);
});

test('caches the measurement so it is not re-read on every request', async () => {
  let reads = 0;
  let clock = 0;
  const guard = createDiskGuard({
    ...base,
    freeBytes: async () => { reads += 1; return 100 * GB; },
    dirSize: async () => 0,
    cacheMs: 10_000,
    now: () => clock,
  });
  await run(guard);
  await run(guard);
  assert.equal(reads, 1);
  clock = 20_000;
  await run(guard);
  assert.equal(reads, 2);
});

test('getDiskStatus reports real numbers for this machine', async () => {
  const status = await getDiskStatus();
  assert.ok(status.freeGb > 0);
  assert.ok(status.usedByAppGb >= 0);
});

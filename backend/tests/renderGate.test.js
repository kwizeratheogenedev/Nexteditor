import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../services/renderGate.js';
import { runFFmpeg } from '../services/ffmpeg.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('gate never runs more than max tasks at once', async () => {
  const gate = createGate(3);
  let running = 0;
  let peak = 0;

  async function task() {
    const release = await gate.acquire();
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 15));
    running -= 1;
    release();
  }

  await Promise.all(Array.from({ length: 20 }, task));
  assert.equal(peak, 3);
  assert.deepEqual(gate.stats(), { active: 0, queued: 0, max: 3 });
});

test('gate serves waiters first-in-first-out', async () => {
  const gate = createGate(1);
  const order = [];
  const first = await gate.acquire();

  const waiters = [1, 2, 3].map((n) => gate.acquire().then((release) => {
    order.push(n);
    release();
  }));

  await tick();
  assert.equal(gate.stats().queued, 3);
  first();
  await Promise.all(waiters);
  assert.deepEqual(order, [1, 2, 3]);
});

test('releasing twice only frees one slot', async () => {
  const gate = createGate(1);
  const release = await gate.acquire();
  release();
  release();
  const a = await gate.acquire();
  let bGotSlot = false;
  gate.acquire().then(() => { bGotSlot = true; });
  await tick();
  assert.equal(bGotSlot, false, 'a double release must not let a second task in');
  a();
});

test('a failing task still frees its slot', async () => {
  const gate = createGate(1);
  await assert.rejects(async () => {
    const release = await gate.acquire();
    try {
      throw new Error('boom');
    } finally {
      release();
    }
  }, /boom/);
  assert.equal(gate.stats().active, 0);
});

test('runFFmpeg still runs a real (tiny) encode through the gate', async () => {
  await runFFmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=0.3', '-f', 'null', '-']);
});

test('runFFmpeg skips a job that was cancelled while queued', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runFFmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=0.3', '-f', 'null', '-'], { signal: controller.signal }),
    /Render cancelled/,
  );
});

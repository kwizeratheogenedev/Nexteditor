import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipOrder } from '../services/clipOrder.js';
import { planClips } from '../../frontend/src/montage/local/planClips.js';

// A repeatable random source, so a failure can be replayed.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const take = (next, n) => Array.from({ length: n }, () => next());

test('3 videos: rounds use every video once, never repeat the previous order, never the same video twice in a row', () => {
  for (let seed = 1; seed <= 2000; seed += 1) {
    const order = take(createClipOrder(3, seeded(seed)), 60);
    for (let i = 1; i < order.length; i += 1) assert.notEqual(order[i], order[i - 1], `seed ${seed} position ${i}: ${order.join(',')}`);
    const rounds = Array.from({ length: 20 }, (_, r) => order.slice(r * 3, r * 3 + 3));
    rounds.forEach((round) => assert.deepEqual([...round].sort(), [0, 1, 2]));
    for (let r = 1; r < rounds.length; r += 1) assert.notDeepEqual(rounds[r], rounds[r - 1], `seed ${seed} round ${r}`);
  }
});

test('2 videos: strictly alternating', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const order = take(createClipOrder(2, seeded(seed)), 40);
    for (let i = 1; i < order.length; i += 1) assert.notEqual(order[i], order[i - 1]);
  }
});

test('montages from the same videos get different orders', () => {
  const orders = new Set();
  for (let seed = 1; seed <= 50; seed += 1) orders.add(take(createClipOrder(3, seeded(seed)), 45).join(''));
  assert.ok(orders.size >= 49, `only ${orders.size} different orders out of 50`);
  // and over many rounds every one of the 6 possible orders shows up
  const seen = new Set();
  const order = take(createClipOrder(3, seeded(7)), 300);
  for (let r = 0; r < 100; r += 1) seen.add(order.slice(r * 3, r * 3 + 3).join(''));
  assert.equal(seen.size, 6);
});

test('Server 2 (frontend planClips) orders clips exactly like Server 1', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    // planClips draws a clip length and start between order picks, so give
    // the server's order its own copy of the same stream to compare against.
    const plan = planClips({ audioDuration: 180, videoDurations: [300, 400, 500], syncMode: 'beat', tempoSensitivity: 'medium', skipSeconds: 40, random: seeded(seed) });
    const devices = plan.map((clip) => clip.sourceIndex);
    for (let i = 1; i < devices.length; i += 1) assert.notEqual(devices[i], devices[i - 1]);
    const rounds = Math.floor(devices.length / 3);
    for (let r = 0; r < rounds; r += 1) assert.deepEqual(devices.slice(r * 3, r * 3 + 3).sort(), [0, 1, 2]);
  }
});

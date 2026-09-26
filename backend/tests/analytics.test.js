import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';

// Pin the timezone before the analytics module reads it.
process.env.ANALYTICS_TIMEZONE = 'Africa/Kigali';
mongoose.set('bufferCommands', false);

const { default: VisitDay } = await import('../models/VisitDay.js');
const analytics = await import('../services/analytics.js');
const { resolveRange, dayStart } = await import('../services/analyticsRange.js');
const { default: analyticsRouter } = await import('../routes/analytics.js');

const writes = [];
VisitDay.updateOne = async (filter, update) => { writes.push({ filter, update }); return {}; };

test('days and hours follow the analytics timezone (Kigali is UTC+2)', () => {
  const lateUtc = new Date('2026-09-25T22:30:00Z'); // 00:30 on the 26th in Kigali
  assert.equal(analytics.dayKey(lateUtc), '2026-09-26');
  assert.equal(analytics.hourOf(lateUtc), 0);
  assert.equal(dayStart('2026-09-26').toISOString(), '2026-09-25T22:00:00.000Z');
});

test('ranges cover the right days and compare against the period just before', () => {
  const now = new Date('2026-09-26T10:00:00Z');
  const week = resolveRange('7d', null, now);
  assert.equal(week.granularity, 'day');
  assert.deepEqual([week.current.days[0], week.current.days[6]], ['2026-09-20', '2026-09-26']);
  assert.deepEqual([week.previous.days[0], week.previous.days[6]], ['2026-09-13', '2026-09-19']);
  const day = resolveRange('day', '2026-09-01', now);
  assert.equal(day.granularity, 'hour');
  assert.deepEqual(day.current.days, ['2026-09-01']);
  assert.deepEqual(day.previous.days, ['2026-08-31']);
  assert.deepEqual(resolveRange('day', '2099-01-01', now).current.days, ['2026-09-26'], 'future dates fall back to today');
  assert.deepEqual(resolveRange('nonsense', null, now).current.days, ['2026-09-26']);
});

test('traffic sources and devices are grouped sensibly', () => {
  assert.equal(analytics.categorizeSource('www.google.com'), 'google');
  assert.equal(analytics.categorizeSource('m.youtube.com'), 'youtube');
  assert.equal(analytics.categorizeSource('youtu.be'), 'youtube');
  assert.equal(analytics.categorizeSource('l.facebook.com'), 'facebook');
  assert.equal(analytics.categorizeSource('', ''), 'direct');
  assert.equal(analytics.categorizeSource('nexeditor.app', '', 'nexeditor.app'), 'direct', 'own site is not a referral');
  assert.equal(analytics.categorizeSource('blog.example.org'), 'other');
  assert.equal(analytics.categorizeSource('', 'WhatsApp'), 'whatsapp');
  assert.equal(analytics.deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148'), 'mobile');
  assert.equal(analytics.deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'tablet');
  assert.equal(analytics.deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140'), 'desktop');
});

test('pings update live presence every time but write at most once a minute', async () => {
  analytics.resetAnalyticsState();
  writes.length = 0;
  const t0 = Date.parse('2026-09-26T08:00:00Z');
  const base = { visitorId: 'visitor-aaaaaaaaaaaa', device: 'desktop', source: 'direct' };
  assert.equal(await analytics.recordPing({ ...base, area: 'editor', now: t0 }), true);
  assert.equal(await analytics.recordPing({ ...base, area: 'montage', now: t0 + 10_000 }), false);
  assert.equal(await analytics.recordPing({ ...base, area: 'montage', now: t0 + 60_000 }), true);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].filter, { day: '2026-09-26', visitorId: 'visitor-aaaaaaaaaaaa' });
  assert.equal(writes[0].update.$inc['areas.editor'], 1);
  assert.equal(writes[0].update.$inc['hours.10'], 1, '08:00 UTC is 10:00 in Kigali');

  await analytics.recordPing({ visitorId: 'visitor-bbbbbbbbbbbb', userId: new mongoose.Types.ObjectId(), area: 'captions', device: 'mobile', source: 'google', now: t0 + 61_000 });
  const snap = analytics.liveSnapshot(t0 + 62_000);
  assert.equal(snap.total, 2);
  assert.equal(snap.signedIn, 1);
  assert.equal(snap.byArea.montage, 1, 'live view shows where each visitor is now');
  assert.equal(snap.byArea.captions, 1);
  assert.equal(analytics.liveSnapshot(t0 + 10 * 60_000).total, 0, 'visitors drop off after 5 quiet minutes');
});

test('request metrics roll into per-minute buckets', () => {
  analytics.resetAnalyticsState();
  const t0 = Math.floor(Date.now() / 60_000) * 60_000;
  analytics.recordRequest({ status: 200, ms: 100, now: t0 + 1000 });
  analytics.recordRequest({ status: 500, ms: 300, now: t0 + 2000 });
  analytics.recordRequest({ status: 200, ms: 50, now: t0 + 61_000 });
  const mins = analytics.recentMinutes(t0 + 62_000);
  const first = mins.find((m) => m.t === t0);
  assert.deepEqual({ requests: first.requests, errors: first.errors, avgMs: first.avgMs }, { requests: 2, errors: 1, avgMs: 200 });
  assert.equal(mins.at(-1).requests, 1);
});

test('the ping endpoint ignores bots and malformed visitor ids', async () => {
  analytics.resetAnalyticsState();
  writes.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/analytics/ping`;
  const send = (body, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/140') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(body) });
  try {
    assert.equal((await send({ visitorId: 'short', area: 'landing' })).status, 204);
    assert.equal((await send({ visitorId: 'visitor-cccccccccccc', area: 'landing' }, 'Googlebot/2.1')).status, 204);
    assert.equal(writes.length, 0);
    assert.equal((await send({ visitorId: 'visitor-cccccccccccc', area: 'landing', referrer: 'youtube.com', isNew: true })).status, 204);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].update.$setOnInsert.source, 'youtube');
    assert.equal(writes[0].update.$set.isNewVisitor, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

import VisitDay from '../models/VisitDay.js';
import ServerHour from '../models/ServerHour.js';
import { logger } from './logger.js';

// Usage analytics: who is using the app right now (in memory), who used it
// on each day (VisitDay rows), and how fast the server answered (in memory
// per minute for the live view, ServerHour rows for history).

export const TIMEZONE = process.env.ANALYTICS_TIMEZONE || 'Africa/Kigali';
export const AREAS = ['landing', 'pricing', 'auth', 'editor', 'montage', 'captions', 'shorts', 'longmix', 'account', 'admin', 'other'];
export const LIVE_WINDOW_MS = 5 * 60 * 1000;
const MIN_PING_GAP_MS = 45 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', hourCycle: 'h23' });

// 'YYYY-MM-DD' / 0-23 in the analytics timezone.
export function dayKey(date = new Date()) {
  return dayFormat.format(date);
}

export function hourOf(date = new Date()) {
  return Number(hourFormat.format(date)) % 24;
}

const SOURCE_RULES = [
  ['google', /(^|\.)google\./],
  ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/],
  ['instagram', /(^|\.)instagram\.com$/],
  ['whatsapp', /(^|\.)(whatsapp\.com|wa\.me)$/],
  ['tiktok', /(^|\.)tiktok\.com$/],
  ['x', /(^|\.)(t\.co|twitter\.com|x\.com)$/],
  ['linkedin', /(^|\.)(linkedin\.com|lnkd\.in)$/],
  ['bing', /(^|\.)bing\.com$/],
];

// Groups a referrer host (or an explicit ?utm_source=) into a traffic source.
export function categorizeSource(referrerHost, utmSource, ownHost) {
  const utm = String(utmSource || '').trim().toLowerCase();
  if (utm) {
    const known = SOURCE_RULES.find(([name]) => utm.includes(name));
    return known ? known[0] : 'campaign';
  }
  const host = String(referrerHost || '').trim().toLowerCase().replace(/^www\./, '');
  if (!host || (ownHost && host === String(ownHost).toLowerCase().replace(/^www\./, ''))) return 'direct';
  const match = SOURCE_RULES.find(([, re]) => re.test(host));
  return match ? match[0] : 'other';
}

export function deviceFromUserAgent(ua) {
  const text = String(ua || '');
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(text)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i.test(text)) return 'mobile';
  return 'desktop';
}

// ---------- Live presence ----------

const live = new Map(); // visitorId -> { userId, area, device, lastSeen, lastWrite }

function pruneLive(now) {
  for (const [id, v] of live) if (now - v.lastSeen > LIVE_WINDOW_MS) live.delete(id);
}

export function liveSnapshot(now = Date.now()) {
  pruneLive(now);
  const byArea = Object.fromEntries(AREAS.map((a) => [a, 0]));
  const byDevice = { desktop: 0, mobile: 0, tablet: 0 };
  let signedIn = 0;
  for (const v of live.values()) {
    byArea[v.area] = (byArea[v.area] || 0) + 1;
    byDevice[v.device] = (byDevice[v.device] || 0) + 1;
    if (v.userId) signedIn += 1;
  }
  return { total: live.size, signedIn, visitors: live.size - signedIn, byArea, byDevice };
}

// Records one "I'm here" ping. The live view updates on every ping; the
// daily row is written at most once per ~minute per visitor, so a page that
// pings faster (or a script) can't inflate the minutes.
export async function recordPing({ visitorId, userId = null, area, device, source, referrerHost = '', isNewVisitor = false, now = Date.now() }) {
  const safeArea = AREAS.includes(area) ? area : 'other';
  const previous = live.get(visitorId);
  const entry = { userId: userId || previous?.userId || null, area: safeArea, device, lastSeen: now, lastWrite: previous?.lastWrite || 0 };
  live.set(visitorId, entry);
  rollMinutes(now);

  if (now - entry.lastWrite < MIN_PING_GAP_MS) return false;
  entry.lastWrite = now;

  const date = new Date(now);
  const update = {
    $inc: { pings: 1, [`areas.${safeArea}`]: 1, [`hours.${hourOf(date)}`]: 1 },
    $set: { lastSeen: date, expireAt: new Date(now + 395 * 24 * HOUR_MS) },
    $setOnInsert: { firstSeen: date, source, referrerHost: String(referrerHost || '').slice(0, 100), device },
  };
  // A visitor who signs in part-way through the day is linked from then on.
  if (userId) update.$set.user = userId;
  if (isNewVisitor) update.$set.isNewVisitor = true;
  await VisitDay.updateOne({ day: dayKey(date), visitorId }, update, { upsert: true });
  return true;
}

// ---------- Server speed ----------

const minutes = []; // last 60 finished minutes: { t, requests, errors, totalMs, active }
let current = { t: Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS, requests: 0, errors: 0, totalMs: 0 };
let hourBucket = null; // not yet flushed: { hour, requests, errors4xx, errors5xx, totalMs, slowRequests }
let timer = null;

function rollMinutes(now) {
  const minute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  if (minute === current.t) return;
  const active = liveSnapshot(now).total;
  // Close the current minute, plus zero-filled minutes for any quiet gap.
  minutes.push({ ...current, active });
  for (let t = current.t + MINUTE_MS; t < minute && minutes.length < 200; t += MINUTE_MS) {
    minutes.push({ t, requests: 0, errors: 0, totalMs: 0, active });
  }
  while (minutes.length > 60) minutes.shift();
  current = { t: minute, requests: 0, errors: 0, totalMs: 0 };
}

async function flushHour() {
  if (!hourBucket || hourBucket.requests === 0) return;
  const { hour, ...inc } = hourBucket;
  hourBucket = { hour, requests: 0, errors4xx: 0, errors5xx: 0, totalMs: 0, slowRequests: 0 };
  try {
    await ServerHour.updateOne({ hour }, { $inc: inc }, { upsert: true });
  } catch (err) {
    logger.warn('Could not save server metrics', { err });
  }
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(() => {
    rollMinutes(Date.now());
    flushHour();
  }, 20 * 1000);
  timer.unref?.();
}

// Called for every finished request by middleware/requestLog.js.
export function recordRequest({ status, ms, slow = false, now = Date.now() }) {
  ensureTimer();
  rollMinutes(now);
  current.requests += 1;
  current.totalMs += ms;
  if (status >= 500) current.errors += 1;

  const hour = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
  if (!hourBucket || hourBucket.hour.getTime() !== hour.getTime()) {
    if (hourBucket) flushHour();
    hourBucket = { hour, requests: 0, errors4xx: 0, errors5xx: 0, totalMs: 0, slowRequests: 0 };
  }
  hourBucket.requests += 1;
  hourBucket.totalMs += ms;
  if (status >= 500) hourBucket.errors5xx += 1;
  else if (status >= 400) hourBucket.errors4xx += 1;
  if (slow) hourBucket.slowRequests += 1;
}

// The last 60 minutes for the live charts, oldest first, including the
// minute in progress.
export function recentMinutes(now = Date.now()) {
  rollMinutes(now);
  const active = liveSnapshot(now).total;
  return [...minutes, { ...current, active }].map((m) => ({
    t: m.t,
    active: m.active,
    requests: m.requests,
    errors: m.errors,
    avgMs: m.requests ? Math.round(m.totalMs / m.requests) : 0,
  }));
}

// Test helper.
export function resetAnalyticsState() {
  live.clear();
  minutes.length = 0;
  current = { t: Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS, requests: 0, errors: 0, totalMs: 0 };
  hourBucket = null;
}

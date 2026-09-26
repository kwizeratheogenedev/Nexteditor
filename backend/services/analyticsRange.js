import { TIMEZONE, dayKey } from './analytics.js';

// Turns a range name ("today", "7d", "day" + date, ...) into the list of
// day keys it covers, the same-length period right before it (for the
// "▲ 12% vs previous" comparisons), and the exact instants those days start
// and end in ANALYTICS_TIMEZONE - for querying Date fields like createdAt.

const DAY_MS = 24 * 60 * 60 * 1000;
export const RANGES = ['today', 'yesterday', '7d', '28d', '90d', 'day'];

function shiftKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return t.toISOString().slice(0, 10);
}

// Offset of TIMEZONE from UTC (ms) at a given instant, e.g. +2h for Kigali.
export function tzOffsetMs(at, timeZone = TIMEZONE) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0)) * 60 * 1000;
}

// The UTC instant a local day starts.
export function dayStart(key, timeZone = TIMEZONE) {
  const [y, m, d] = key.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  return new Date(utcMidnight - tzOffsetMs(new Date(utcMidnight), timeZone));
}

function listDays(lastKey, count) {
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) days.push(shiftKey(lastKey, -i));
  return days;
}

export function resolveRange(range, date, now = new Date()) {
  const today = dayKey(now);
  let days;
  switch (range) {
    case 'yesterday': days = [shiftKey(today, -1)]; break;
    case '7d': days = listDays(today, 7); break;
    case '28d': days = listDays(today, 28); break;
    case '90d': days = listDays(today, 90); break;
    case 'day': {
      const valid = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
      days = [valid ? date : today];
      break;
    }
    default: days = [today];
  }
  const previous = listDays(shiftKey(days[0], -1), days.length);
  const window = (list) => ({ days: list, from: dayStart(list[0]), to: dayStart(shiftKey(list[list.length - 1], 1)) });
  return {
    range: RANGES.includes(range) ? range : 'today',
    granularity: days.length === 1 ? 'hour' : 'day',
    current: window(days),
    previous: window(previous),
  };
}

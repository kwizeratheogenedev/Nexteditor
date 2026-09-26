import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import User from '../models/User.js';
import Job from '../models/Job.js';
import Payment from '../models/Payment.js';
import VisitDay from '../models/VisitDay.js';
import ServerHour from '../models/ServerHour.js';
import { ffmpegGate } from '../services/renderGate.js';
import { TIMEZONE, dayKey, liveSnapshot, recentMinutes } from '../services/analytics.js';
import { resolveRange } from '../services/analyticsRange.js';

// The admin panel's Analytics section: a live view and per-period reports.
const router = express.Router();
router.use(requireAuth, requireAdmin);

// ---------- Live ----------

router.get('/live', async (_req, res) => {
  const today = dayKey();
  const { from } = resolveRange('today').current;
  const [visitorsToday, signupsToday, rendersToday, runningJobs] = await Promise.all([
    VisitDay.countDocuments({ day: today }),
    User.countDocuments({ createdAt: { $gte: from } }),
    Job.countDocuments({ createdAt: { $gte: from } }),
    Job.countDocuments({ status: 'running' }),
  ]);
  res.json({
    now: new Date(),
    timezone: TIMEZONE,
    active: liveSnapshot(),
    minutes: recentMinutes(),
    render: { ...ffmpegGate.stats(), runningJobs },
    today: { visitors: visitorsToday, signups: signupsToday, renders: rendersToday },
  });
});

// ---------- Period report ----------

async function visitKpis(days) {
  const [row] = await VisitDay.aggregate([
    { $match: { day: { $in: days } } },
    {
      $group: {
        _id: null,
        visitorIds: { $addToSet: '$visitorId' },
        userIds: { $addToSet: '$user' },
        visitorDays: { $sum: 1 },
        minutes: { $sum: '$pings' },
        newVisitors: { $sum: { $cond: ['$isNewVisitor', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        visitors: { $size: '$visitorIds' },
        signedInUsers: { $size: { $filter: { input: '$userIds', cond: { $ne: ['$$this', null] } } } },
        visitorDays: 1,
        minutes: 1,
        newVisitors: 1,
      },
    },
  ]);
  return row || { visitors: 0, signedInUsers: 0, visitorDays: 0, minutes: 0, newVisitors: 0 };
}

async function otherKpis({ from, to }) {
  const [signups, jobs, avgRender, payments, server] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: from, $lt: to } }),
    Job.aggregate([{ $match: { createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Job.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to }, status: 'done' } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ['$updatedAt', '$createdAt'] } } } },
    ]),
    Payment.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to }, status: 'successful' } },
      { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 }, users: { $addToSet: '$user' } } },
    ]),
    ServerHour.aggregate([
      { $match: { hour: { $gte: from, $lt: to } } },
      { $group: { _id: null, requests: { $sum: '$requests' }, errors5xx: { $sum: '$errors5xx' }, totalMs: { $sum: '$totalMs' } } },
    ]),
  ]);
  const byStatus = Object.fromEntries(jobs.map((j) => [j._id, j.n]));
  const finished = (byStatus.done || 0) + (byStatus.error || 0);
  const proBuyers = new Set(payments.flatMap((p) => p.users.filter(Boolean).map(String)));
  const srv = server[0] || { requests: 0, errors5xx: 0, totalMs: 0 };
  return {
    signups,
    renders: finished + (byStatus.running || 0),
    rendersFailed: byStatus.error || 0,
    renderSuccessRate: finished ? (byStatus.done || 0) / finished : null,
    avgRenderSeconds: avgRender[0] ? Math.round(avgRender[0].avgMs / 1000) : null,
    revenue: payments.map((p) => ({ currency: p._id || '?', total: p.total, count: p.count })),
    proPurchases: proBuyers.size,
    requests: srv.requests,
    errorRate: srv.requests ? srv.errors5xx / srv.requests : null,
    avgResponseMs: srv.requests ? Math.round(srv.totalMs / srv.requests) : null,
  };
}

async function kpisFor(window) {
  const [visits, other] = await Promise.all([visitKpis(window.days), otherKpis(window)]);
  return {
    ...visits,
    ...other,
    avgMinutesPerVisitor: visits.visitorDays ? Math.round((visits.minutes / visits.visitorDays) * 10) / 10 : null,
    signupConversion: visits.newVisitors ? other.signups / visits.newVisitors : null,
  };
}

// Buckets: one per hour (single day) or per day.
async function seriesFor(window, granularity, primaryCurrency) {
  const hourly = granularity === 'hour';
  const keys = hourly ? Array.from({ length: 24 }, (_, h) => String(h)) : window.days;
  const buckets = new Map(keys.map((k) => [k, { key: k, visitors: 0, signedIn: 0, signups: 0, rendersDone: 0, rendersFailed: 0, revenue: 0, requests: 0, avgMs: 0, totalMs: 0 }]));
  const dateMatch = { $gte: window.from, $lt: window.to };
  const bucketExpr = (field) => (hourly
    ? { $toString: { $hour: { date: field, timezone: TIMEZONE } } }
    : { $dateToString: { format: '%Y-%m-%d', date: field, timezone: TIMEZONE } });

  const [visits, signups, jobs, payments, server] = await Promise.all([
    hourly
      ? VisitDay.find({ day: window.days[0] }, { hours: 1, user: 1 }).lean()
      : VisitDay.aggregate([
        { $match: { day: { $in: window.days } } },
        { $group: { _id: '$day', visitors: { $sum: 1 }, signedIn: { $sum: { $cond: [{ $ne: ['$user', null] }, 1, 0] } } } },
      ]),
    User.aggregate([{ $match: { createdAt: dateMatch } }, { $group: { _id: bucketExpr('$createdAt'), n: { $sum: 1 } } }]),
    Job.aggregate([{ $match: { createdAt: dateMatch, status: { $in: ['done', 'error'] } } }, { $group: { _id: { b: bucketExpr('$createdAt'), s: '$status' }, n: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { createdAt: dateMatch, status: 'successful', currency: primaryCurrency } }, { $group: { _id: bucketExpr('$createdAt'), total: { $sum: '$amount' } } }]),
    ServerHour.aggregate([{ $match: { hour: dateMatch } }, { $group: { _id: bucketExpr('$hour'), requests: { $sum: '$requests' }, totalMs: { $sum: '$totalMs' } } }]),
  ]);

  if (hourly) {
    for (const doc of visits) {
      const hours = doc.hours || {};
      for (const [h, n] of Object.entries(hours)) {
        const b = buckets.get(String(h));
        if (b && n > 0) {
          b.visitors += 1;
          if (doc.user) b.signedIn += 1;
        }
      }
    }
  } else {
    for (const v of visits) {
      const b = buckets.get(v._id);
      if (b) { b.visitors = v.visitors; b.signedIn = v.signedIn; }
    }
  }
  for (const s of signups) { const b = buckets.get(s._id); if (b) b.signups = s.n; }
  for (const j of jobs) {
    const b = buckets.get(j._id.b);
    if (b) b[j._id.s === 'done' ? 'rendersDone' : 'rendersFailed'] = j.n;
  }
  for (const p of payments) { const b = buckets.get(p._id); if (b) b.revenue = p.total; }
  for (const s of server) {
    const b = buckets.get(s._id);
    if (b) { b.requests = s.requests; b.avgMs = s.requests ? Math.round(s.totalMs / s.requests) : 0; }
  }
  return [...buckets.values()].map(({ totalMs: _unused, ...rest }) => rest);
}

async function breakdownsFor(window) {
  const match = { day: { $in: window.days } };
  const [areas, sources, devices, referrers, topUsers, renderKinds] = await Promise.all([
    VisitDay.aggregate([
      { $match: match },
      { $project: { areas: { $objectToArray: { $ifNull: ['$areas', {}] } } } },
      { $unwind: '$areas' },
      { $group: { _id: '$areas.k', minutes: { $sum: '$areas.v' }, visitors: { $sum: 1 } } },
      { $sort: { minutes: -1 } },
    ]),
    VisitDay.aggregate([{ $match: match }, { $group: { _id: '$source', visits: { $sum: 1 } } }, { $sort: { visits: -1 } }]),
    VisitDay.aggregate([{ $match: match }, { $group: { _id: '$device', visits: { $sum: 1 } } }, { $sort: { visits: -1 } }]),
    VisitDay.aggregate([
      { $match: { ...match, source: 'other', referrerHost: { $ne: '' } } },
      { $group: { _id: '$referrerHost', visits: { $sum: 1 } } },
      { $sort: { visits: -1 } },
      { $limit: 8 },
    ]),
    VisitDay.aggregate([
      { $match: { ...match, user: { $ne: null } } },
      { $group: { _id: '$user', minutes: { $sum: '$pings' }, days: { $sum: 1 }, lastSeen: { $max: '$lastSeen' } } },
      { $sort: { minutes: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u', pipeline: [{ $project: { email: 1, name: 1 } }] } },
      { $lookup: { from: 'jobs', localField: '_id', foreignField: 'owner', as: 'j', pipeline: [{ $match: { createdAt: { $gte: window.from, $lt: window.to } } }, { $count: 'n' }] } },
    ]),
    Job.aggregate([
      { $match: { createdAt: { $gte: window.from, $lt: window.to } } },
      { $group: { _id: '$kind', total: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } } } },
      { $sort: { total: -1 } },
    ]),
  ]);
  return {
    areas: areas.map((a) => ({ area: a._id, minutes: a.minutes, visitors: a.visitors })),
    sources: sources.map((s) => ({ source: s._id, visits: s.visits })),
    devices: devices.map((d) => ({ device: d._id, visits: d.visits })),
    referrers: referrers.map((r) => ({ host: r._id, visits: r.visits })),
    topUsers: topUsers.map((t) => ({
      _id: t._id,
      email: t.u[0]?.email || 'deleted account',
      name: t.u[0]?.name || '',
      minutes: t.minutes,
      days: t.days,
      renders: t.j[0]?.n || 0,
      lastSeen: t.lastSeen,
    })),
    renderKinds: renderKinds.map((k) => ({ kind: k._id, total: k.total, failed: k.failed })),
  };
}

router.get('/summary', async (req, res) => {
  const { range, granularity, current, previous } = resolveRange(String(req.query.range || 'today'), req.query.date);
  const [now, before, firstVisit] = await Promise.all([
    kpisFor(current),
    kpisFor(previous),
    VisitDay.findOne({}, { day: 1 }).sort({ day: 1 }).lean(),
  ]);
  // Revenue charts follow the currency with the most revenue in the period.
  const primaryCurrency = [...now.revenue].sort((a, b) => b.total - a.total)[0]?.currency || 'RWF';
  const [series, breakdown] = await Promise.all([seriesFor(current, granularity, primaryCurrency), breakdownsFor(current)]);
  res.json({
    range,
    granularity,
    timezone: TIMEZONE,
    days: current.days,
    previousDays: previous.days,
    primaryCurrency,
    trackingSince: firstVisit?.day || null,
    kpis: { current: now, previous: before },
    series,
    breakdown,
  });
});

export { kpisFor, seriesFor, breakdownsFor };
export default router;

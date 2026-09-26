import express from 'express';
import os from 'os';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import User from '../models/User.js';
import Project from '../models/Project.js';
import Job from '../models/Job.js';
import Payment from '../models/Payment.js';
import AdminAction from '../models/AdminAction.js';
import { isAdmin } from '../services/roles.js';
import { isOwnerEmail } from '../services/owners.js';
import { isPro } from '../services/planLimits.js';
import { extendProPeriod, grantLifetimePro, revokePro } from '../services/subscription.js';
import { recordPayment } from '../services/payments.js';
import { deleteAccount } from '../services/accountDeletion.js';
import { ffmpegGate } from '../services/renderGate.js';
import { currentVideoEncoder } from '../services/encoders.js';
import { getDiskStatus } from '../middleware/diskGuard.js';
import { isMomoConfigured } from '../services/momoClient.js';
import { isFlutterwaveConfigured } from '../services/flutterwaveClient.js';
import { accountSummary } from './account.js';

// The admin panel's API. Every route requires a signed-in admin, and every
// change is written to the AdminAction audit log.
const router = express.Router();
router.use(requireAuth, requireAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;
const startedAt = Date.now();

function page(req) {
  const p = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  return { page: p, limit, skip: (p - 1) * limit };
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function activeProFilter(now = new Date()) {
  return {
    'subscription.plan': 'pro',
    'subscription.status': 'active',
    $or: [{ 'subscription.currentPeriodEnd': null }, { 'subscription.currentPeriodEnd': { $gt: now } }],
  };
}

// The fields the users table needs - never the password hash or tokens.
function userRow(user) {
  return {
    _id: user._id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role || 'user',
    status: user.status || 'active',
    suspendedReason: user.suspendedReason || '',
    isAdmin: isAdmin(user),
    isOwner: isOwnerEmail(user.email),
    isPro: isPro(user),
    plan: user.subscription?.plan || 'free',
    periodEnd: user.subscription?.currentPeriodEnd || null,
    authProviders: user.authProviders || [],
    usage: user.usage || {},
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

async function logAction(req, action, target, details = null) {
  await AdminAction.create({
    admin: req.user._id,
    adminEmail: req.user.email,
    action,
    targetUser: target?._id || null,
    targetEmail: target?.email || '',
    details,
  });
}

// Loads :id into req.target, or answers 404.
async function loadTarget(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  const target = await User.findById(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  req.target = target;
  next();
}

// Owners (OWNER_EMAILS) and the admin's own account can't be suspended,
// demoted or deleted from the panel - that's how an admin locks themselves
// (or the owner) out.
function refuseProtected(req, res, what) {
  if (String(req.target._id) === String(req.user._id)) {
    res.status(400).json({ error: `You can't ${what} your own account.` });
    return true;
  }
  if (isOwnerEmail(req.target.email)) {
    res.status(400).json({ error: `Owner accounts (OWNER_EMAILS in backend/.env) can't be ${what === 'delete' ? 'deleted' : what === 'suspend' ? 'suspended' : 'changed this way'} from the panel.` });
    return true;
  }
  return false;
}

// ---------- Overview ----------

router.get('/overview', async (_req, res) => {
  const now = new Date();
  const weekAgo = new Date(now - 7 * DAY_MS);
  const monthAgo = new Date(now - 30 * DAY_MS);
  const dayAgo = new Date(now - DAY_MS);

  const [
    totalUsers, newUsers7d, proUsers, suspendedUsers, adminUsers,
    totalProjects, jobs24h, runningJobs, revenueAll, revenue30d,
    recentUsers, recentPayments, recentFailures,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    User.countDocuments(activeProFilter(now)),
    User.countDocuments({ status: 'suspended' }),
    User.countDocuments({ role: 'admin' }),
    Project.countDocuments({ isDeleted: false }),
    Job.aggregate([{ $match: { createdAt: { $gte: dayAgo } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Job.countDocuments({ status: 'running' }),
    Payment.aggregate([{ $match: { status: 'successful' } }, { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { status: 'successful', createdAt: { $gte: monthAgo } } }, { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    User.find({}).sort({ createdAt: -1 }).limit(6),
    Payment.find({}).sort({ createdAt: -1 }).limit(6).lean(),
    Job.find({ status: 'error' }).sort({ createdAt: -1 }).limit(6).populate('owner', 'email').lean(),
  ]);

  // Owners are always Pro/admin even when their stored record says otherwise.
  const owners = await User.find({ email: { $in: (process.env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) } }, 'role subscription').lean();
  const extraOwnerAdmins = owners.filter((o) => o.role !== 'admin').length;

  let disk = null;
  try { disk = await getDiskStatus(); } catch { /* unsupported */ }

  res.json({
    users: { total: totalUsers, new7d: newUsers7d, pro: proUsers, free: totalUsers - proUsers, suspended: suspendedUsers, admins: adminUsers + extraOwnerAdmins },
    projects: { total: totalProjects },
    jobs: {
      last24h: Object.fromEntries(jobs24h.map((j) => [j._id, j.count])),
      running: runningJobs,
    },
    revenue: {
      allTime: revenueAll.map((r) => ({ currency: r._id || '?', total: r.total, count: r.count })),
      last30d: revenue30d.map((r) => ({ currency: r._id || '?', total: r.total, count: r.count })),
    },
    recentUsers: recentUsers.map(userRow),
    recentPayments,
    recentFailures,
    system: { render: ffmpegGate.stats(), disk, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) },
  });
});

// ---------- Users ----------

router.get('/users', async (req, res) => {
  const { page: p, limit, skip } = page(req);
  const filter = {};
  const q = String(req.query.q || '').trim();
  if (q) filter.$or = [{ email: new RegExp(escapeRegex(q), 'i') }, { name: new RegExp(escapeRegex(q), 'i') }];
  switch (req.query.filter) {
    case 'pro': Object.assign(filter, activeProFilter()); break;
    case 'free': filter.$nor = [activeProFilter()]; break;
    case 'suspended': filter.status = 'suspended'; break;
    case 'admin': filter.role = 'admin'; break;
    default: break;
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ users: users.map(userRow), total, page: p, pages: Math.max(1, Math.ceil(total / limit)) });
});

// Create an account on someone's behalf (e.g. a customer who paid in cash).
router.post('/users', async (req, res) => {
  const { email, password, name, role } = req.body || {};
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  const normalized = email.trim().toLowerCase();
  if (await User.exists({ email: normalized })) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }
  const user = await User.create({
    email: normalized,
    passwordHash: await bcrypt.hash(password, 10),
    name: String(name || '').trim().slice(0, 80),
    authProviders: ['local'],
    role: role === 'admin' ? 'admin' : 'user',
  });
  await logAction(req, 'user.create', user, { role: user.role });
  res.status(201).json({ user: userRow(user) });
});

router.get('/users/:id', loadTarget, async (req, res) => {
  const id = req.target._id;
  const [projects, jobs, payments, actions, projectCount] = await Promise.all([
    Project.find({ owner: id, isDeleted: false }).select('-data').sort({ updatedAt: -1 }).limit(50).lean(),
    Job.find({ owner: id }).sort({ createdAt: -1 }).limit(30).lean(),
    Payment.find({ user: id }).sort({ createdAt: -1 }).limit(50).lean(),
    AdminAction.find({ targetUser: id }).sort({ createdAt: -1 }).limit(30).lean(),
    Project.countDocuments({ owner: id, isDeleted: false }),
  ]);
  res.json({
    user: userRow(req.target),
    summary: accountSummary(req.target, { projectCount }),
    projects,
    jobs,
    payments,
    actions,
  });
});

router.patch('/users/:id', loadTarget, async (req, res) => {
  const { name, email } = req.body || {};
  const changes = {};
  if (typeof name === 'string') {
    req.target.name = name.trim().slice(0, 80);
    changes.name = req.target.name;
  }
  if (typeof email === 'string' && email.trim().toLowerCase() !== req.target.email) {
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }
    if (isOwnerEmail(req.target.email)) {
      res.status(400).json({ error: "An owner account's email is set in OWNER_EMAILS and can't be changed here." });
      return;
    }
    const normalized = email.trim().toLowerCase();
    if (await User.exists({ email: normalized })) {
      res.status(409).json({ error: 'Another account already uses this email.' });
      return;
    }
    changes.email = { from: req.target.email, to: normalized };
    req.target.email = normalized;
  }
  await req.target.save();
  await logAction(req, 'user.edit', req.target, changes);
  res.json({ user: userRow(req.target) });
});

router.post('/users/:id/pro', loadTarget, async (req, res) => {
  const { days, lifetime, amount, currency, note } = req.body || {};
  if (lifetime) {
    grantLifetimePro(req.target);
  } else {
    const n = parseInt(days, 10);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      res.status(400).json({ error: 'Enter a number of days between 1 and 3650.' });
      return;
    }
    extendProPeriod(req.target, n);
  }
  await req.target.save();
  // A cash / bank payment taken outside the app can be recorded with it.
  if (Number(amount) > 0) {
    await recordPayment({
      user: req.target,
      provider: 'manual',
      reference: `manual-${req.target._id}-${Date.now()}`,
      amount,
      currency: String(currency || '').toUpperCase().slice(0, 8),
      periodEnd: req.target.subscription.currentPeriodEnd,
      note: String(note || '').slice(0, 200),
      createdBy: req.user._id,
    });
  }
  await logAction(req, 'pro.grant', req.target, { days: lifetime ? 'lifetime' : Number(days), amount: Number(amount) || 0, currency: currency || '' });
  res.json({ user: userRow(req.target) });
});

router.delete('/users/:id/pro', loadTarget, async (req, res) => {
  if (isOwnerEmail(req.target.email)) {
    res.status(400).json({ error: 'Owner accounts are always Pro (OWNER_EMAILS in backend/.env).' });
    return;
  }
  revokePro(req.target);
  await req.target.save();
  await logAction(req, 'pro.revoke', req.target);
  res.json({ user: userRow(req.target) });
});

router.post('/users/:id/reset-quota', loadTarget, async (req, res) => {
  req.target.usage.exportsThisPeriod = 0;
  req.target.usage.exportsPeriodStart = new Date();
  await req.target.save();
  await logAction(req, 'quota.reset', req.target);
  res.json({ user: userRow(req.target) });
});

router.post('/users/:id/suspend', loadTarget, async (req, res) => {
  if (refuseProtected(req, res, 'suspend')) return;
  req.target.status = 'suspended';
  req.target.suspendedReason = String(req.body?.reason || '').slice(0, 300);
  await req.target.save();
  await logAction(req, 'user.suspend', req.target, { reason: req.target.suspendedReason });
  res.json({ user: userRow(req.target) });
});

router.post('/users/:id/unsuspend', loadTarget, async (req, res) => {
  req.target.status = 'active';
  req.target.suspendedReason = '';
  await req.target.save();
  await logAction(req, 'user.unsuspend', req.target);
  res.json({ user: userRow(req.target) });
});

router.patch('/users/:id/role', loadTarget, async (req, res) => {
  const role = req.body?.role;
  if (!['user', 'admin'].includes(role)) {
    res.status(400).json({ error: "Role must be 'user' or 'admin'." });
    return;
  }
  if (role === 'user' && refuseProtected(req, res, 'demote')) return;
  req.target.role = role;
  await req.target.save();
  await logAction(req, role === 'admin' ? 'role.promote' : 'role.demote', req.target);
  res.json({ user: userRow(req.target) });
});

router.post('/users/:id/password', loadTarget, async (req, res) => {
  const { newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'The new password must be at least 8 characters.' });
    return;
  }
  req.target.passwordHash = await bcrypt.hash(newPassword, 10);
  if (!req.target.authProviders.includes('local')) req.target.authProviders.push('local');
  await req.target.save();
  // The password itself is never logged.
  await logAction(req, 'user.password_reset', req.target);
  res.json({ ok: true });
});

router.delete('/users/:id', loadTarget, async (req, res) => {
  if (refuseProtected(req, res, 'delete')) return;
  const result = await deleteAccount(req.target._id);
  await logAction(req, 'user.delete', req.target, result);
  res.json({ ok: true, ...result });
});

// ---------- Payments ----------

router.get('/payments', async (req, res) => {
  const { page: p, limit, skip } = page(req);
  const filter = {};
  if (['momo', 'card', 'manual'].includes(req.query.provider)) filter.provider = req.query.provider;
  const q = String(req.query.q || '').trim();
  if (q) filter.$or = [{ userEmail: new RegExp(escapeRegex(q), 'i') }, { reference: new RegExp(escapeRegex(q), 'i') }];
  const [payments, total, totals] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
    Payment.aggregate([{ $match: { ...filter, status: 'successful' } }, { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
  ]);
  res.json({
    payments,
    total,
    page: p,
    pages: Math.max(1, Math.ceil(total / limit)),
    totals: totals.map((t) => ({ currency: t._id || '?', total: t.total, count: t.count })),
  });
});

router.patch('/payments/:id', async (req, res) => {
  const status = req.body?.status;
  if (!['successful', 'refunded'].includes(status) || !mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ error: "Status must be 'successful' or 'refunded'." });
    return;
  }
  const payment = await Payment.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
  if (!payment) {
    res.status(404).json({ error: 'Payment not found.' });
    return;
  }
  await logAction(req, `payment.${status}`, payment.user ? { _id: payment.user, email: payment.userEmail } : null, { reference: payment.reference });
  res.json({ payment });
});

// ---------- Jobs & projects ----------

router.get('/jobs', async (req, res) => {
  const { page: p, limit, skip } = page(req);
  const filter = {};
  if (['running', 'done', 'error'].includes(req.query.status)) filter.status = req.query.status;
  if (['montage', 'export', 'captions', 'shorts', 'youtube-upload'].includes(req.query.kind)) filter.kind = req.query.kind;
  const [jobs, total] = await Promise.all([
    Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('owner', 'email name').lean(),
    Job.countDocuments(filter),
  ]);
  res.json({ jobs, total, page: p, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get('/projects', async (req, res) => {
  const { page: p, limit, skip } = page(req);
  const filter = { isDeleted: false };
  const q = String(req.query.q || '').trim();
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');
  const [projects, total] = await Promise.all([
    Project.find(filter).select('-data').sort({ updatedAt: -1 }).skip(skip).limit(limit).populate('owner', 'email name').lean(),
    Project.countDocuments(filter),
  ]);
  res.json({ projects, total, page: p, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.delete('/projects/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  project.isDeleted = true;
  await project.save();
  await User.updateOne({ _id: project.owner, 'usage.projectCount': { $gt: 0 } }, { $inc: { 'usage.projectCount': -1 } });
  const owner = await User.findById(project.owner, 'email');
  await logAction(req, 'project.delete', owner, { projectId: project._id, name: project.name });
  res.json({ ok: true });
});

// ---------- Audit log & system ----------

router.get('/actions', async (req, res) => {
  const { page: p, limit, skip } = page(req);
  const [actions, total] = await Promise.all([
    AdminAction.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AdminAction.countDocuments({}),
  ]);
  res.json({ actions, total, page: p, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get('/system', async (_req, res) => {
  let disk = null;
  try { disk = await getDiskStatus(); } catch { /* unsupported */ }
  const mem = process.memoryUsage();
  res.json({
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    cpus: os.cpus()?.length || 0,
    memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), systemFreeMb: Math.round(os.freemem() / 1048576), systemTotalMb: Math.round(os.totalmem() / 1048576) },
    render: ffmpegGate.stats(),
    exportEncoder: currentVideoEncoder(),
    disk,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    // Which integrations have credentials configured - never the values.
    integrations: {
      momo: isMomoConfigured(),
      cards: isFlutterwaveConfigured(),
      googleLogin: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_LOGIN_REDIRECT_URI),
      youtubeUpload: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REDIRECT_URI),
    },
    owners: (process.env.OWNER_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean),
    environment: process.env.NODE_ENV || 'development',
  });
});

export default router;

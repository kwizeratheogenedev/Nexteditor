import express from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/auth.js';
import Project from '../models/Project.js';
import Payment from '../models/Payment.js';
import { isAdmin } from '../services/roles.js';
import { isOwnerEmail } from '../services/owners.js';
import { hasLifetimePro, proDaysLeft } from '../services/subscription.js';
import { deleteAccount } from '../services/accountDeletion.js';
import {
  isPro,
  FREE_PROJECT_LIMIT,
  FREE_EXPORT_MAX_SECONDS,
  FREE_MONTHLY_EXPORT_LIMIT,
  FREE_STORAGE_BYTES_LIMIT,
} from '../services/planLimits.js';

// Everything the signed-in user can see and change about their own account:
// profile, plan, usage against the free-tier limits, payment history,
// password, and deleting the account.
const router = express.Router();
router.use(requireAuth);

const SESSION_COOKIE = 'nexeditor_session';
const QUOTA_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export function accountSummary(user, { projectCount }) {
  const pro = isPro(user);
  const owner = isOwnerEmail(user.email);
  const periodStart = user.usage?.exportsPeriodStart ? new Date(user.usage.exportsPeriodStart) : new Date();
  return {
    user: { ...user.toJSON(), isAdmin: isAdmin(user) },
    hasPassword: Boolean(user.passwordHash),
    plan: {
      isPro: pro,
      isOwner: owner,
      lifetime: owner || hasLifetimePro(user),
      periodEnd: owner ? null : user.subscription?.currentPeriodEnd || null,
      daysLeft: owner ? null : proDaysLeft(user),
    },
    usage: {
      projects: { used: projectCount, limit: pro ? null : FREE_PROJECT_LIMIT },
      exports: {
        used: user.usage?.exportsThisPeriod || 0,
        limit: pro ? null : FREE_MONTHLY_EXPORT_LIMIT,
        resetsAt: new Date(periodStart.getTime() + QUOTA_PERIOD_MS),
      },
      storage: { usedBytes: user.usage?.storageBytesUsed || 0, limitBytes: pro ? null : FREE_STORAGE_BYTES_LIMIT },
      exportMaxSeconds: pro ? null : FREE_EXPORT_MAX_SECONDS,
    },
    youtube: {
      connected: Boolean(user.youtube?.refreshToken || user.youtube?.accessToken),
      channelTitle: user.youtube?.channelTitle || null,
    },
  };
}

router.get('/', async (req, res) => {
  const projectCount = await Project.countDocuments({ owner: req.user._id, isDeleted: false });
  res.json(accountSummary(req.user, { projectCount }));
});

router.patch('/profile', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : null;
  if (name === null || name.length > 80) {
    res.status(400).json({ error: 'Enter a name up to 80 characters.' });
    return;
  }
  req.user.name = name;
  await req.user.save();
  res.json({ user: { ...req.user.toJSON(), isAdmin: isAdmin(req.user) } });
});

// Accounts created with Google have no password yet - they can set one
// without a current password, which also enables email + password sign-in.
router.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'The new password must be at least 8 characters.' });
    return;
  }
  if (req.user.passwordHash) {
    const ok = typeof currentPassword === 'string' && await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!ok) {
      res.status(400).json({ error: 'Your current password is incorrect.' });
      return;
    }
  }
  req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  if (!req.user.authProviders.includes('local')) req.user.authProviders.push('local');
  await req.user.save();
  res.json({ ok: true });
});

router.get('/payments', async (req, res) => {
  const payments = await Payment.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ payments });
});

// Password-protected for password accounts; Google-only accounts confirm by
// typing DELETE instead.
router.delete('/', async (req, res) => {
  const { password, confirm } = req.body || {};
  if (req.user.passwordHash) {
    const ok = typeof password === 'string' && await bcrypt.compare(password, req.user.passwordHash);
    if (!ok) {
      res.status(400).json({ error: 'Your password is incorrect.' });
      return;
    }
  } else if (confirm !== 'DELETE') {
    res.status(400).json({ error: 'Type DELETE to confirm.' });
    return;
  }
  await deleteAccount(req.user._id);
  res.clearCookie(SESSION_COOKIE, { domain: process.env.COOKIE_DOMAIN || undefined });
  res.json({ ok: true });
});

export default router;

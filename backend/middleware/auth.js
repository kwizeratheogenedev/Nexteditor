import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Comma-separated allowlist of emails that always get full Pro access,
// regardless of payment status - for the app owner's own account(s). Applied
// on every authenticated request (self-healing: a fresh signup/relogin with
// a listed email is upgraded automatically, no manual DB edit needed).
const OWNER_EMAILS = (process.env.OWNER_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export async function ensureOwnerAccess(user) {
  if (!user || !OWNER_EMAILS.includes(user.email.toLowerCase())) return user;
  if (user.subscription.plan !== 'pro' || user.subscription.status !== 'active') {
    user.subscription.plan = 'pro';
    user.subscription.status = 'active';
    await user.save();
  }
  return user;
}

export async function requireAuth(req, res, next) {
  const token = req.cookies?.nexeditor_session;
  if (!token) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    req.user = await ensureOwnerAccess(user);
    next();
  } catch (_err) {
    res.status(401).json({ error: 'Session expired - please sign in again.' });
  }
}

// Attaches req.user when a valid session cookie is present, but never
// rejects the request - for routes that don't require login (e.g. montage
// creation) but still want to associate a Job with its owner when the
// caller happens to be signed in.
export async function optionalAuth(req, _res, next) {
  const token = req.cookies?.nexeditor_session;
  if (!token) {
    next();
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (user) req.user = await ensureOwnerAccess(user);
  } catch (_err) {
    // Invalid/expired token - proceed unauthenticated rather than failing.
  }
  next();
}

export function requireSubscription(_feature) {
  return (req, res, next) => {
    if (req.user?.subscription?.plan !== 'pro') {
      res.status(403).json({ error: 'This feature requires a Pro plan.', code: 'UPGRADE_REQUIRED' });
      return;
    }
    next();
  };
}

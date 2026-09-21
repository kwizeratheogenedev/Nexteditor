import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isOwnerEmail } from '../services/owners.js';
import { isPro } from '../services/planLimits.js';

// Owner accounts (OWNER_EMAILS in backend/.env - see services/owners.js)
// always get full Pro access regardless of payment status. This keeps the
// STORED subscription in step on every authenticated request, so the owner's
// account also *looks* Pro everywhere the UI reads it from - but the limits
// themselves no longer depend on this write having happened: isPro() checks
// the owner list directly (see services/planLimits.js). That matters because
// a failed save, a stale session, or an account created before the email was
// added to OWNER_EMAILS would otherwise leave the owner capped at free-tier
// limits with no obvious reason why.
export async function ensureOwnerAccess(user) {
  if (!user) return user;
  if (!isOwnerEmail(user.email)) {
    // Lapsed period-based (MoMo) Pro: keep the stored plan in step with what
    // isPro() already enforces, so the UI stops showing Pro too.
    const end = user.subscription?.currentPeriodEnd;
    if (user.subscription?.plan === 'pro' && end && new Date(end).getTime() <= Date.now()) {
      user.subscription.plan = 'free';
      user.subscription.status = 'none';
      await user.save();
    }
    return user;
  }
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
    // isPro covers owner accounts too, so this gate can't lock the owner out
    // of a Pro-only feature.
    if (!isPro(req.user)) {
      res.status(403).json({ error: 'This feature requires a Pro plan.', code: 'UPGRADE_REQUIRED' });
      return;
    }
    next();
  };
}

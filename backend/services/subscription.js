// Shared Pro-period math, used by card payments, the admin panel and the
// account page. (MoMo keeps its own identical stacking logic in
// routes/billingMomo.js.)

export const PRO_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function endMs(user) {
  const end = user?.subscription?.currentPeriodEnd;
  return end ? new Date(end).getTime() : 0;
}

export function hasLifetimePro(user) {
  return user?.subscription?.plan === 'pro' && user?.subscription?.status === 'active' && !user?.subscription?.currentPeriodEnd;
}

// Adds `days` of Pro, stacking on any time the user still has left. A user
// with lifetime Pro (no end date) keeps it - extending never shortens.
export function extendProPeriod(user, days, now = Date.now()) {
  if (hasLifetimePro(user)) return null;
  const currentEnd = endMs(user);
  const base = user.subscription.plan === 'pro' && currentEnd > now ? currentEnd : now;
  user.subscription.plan = 'pro';
  user.subscription.status = 'active';
  user.subscription.currentPeriodEnd = new Date(base + days * DAY_MS);
  return user.subscription.currentPeriodEnd;
}

export function grantLifetimePro(user) {
  user.subscription.plan = 'pro';
  user.subscription.status = 'active';
  user.subscription.currentPeriodEnd = null;
}

export function revokePro(user) {
  user.subscription.plan = 'free';
  user.subscription.status = 'canceled';
  user.subscription.currentPeriodEnd = null;
}

export function proDaysLeft(user, now = Date.now()) {
  const end = endMs(user);
  if (!end) return null;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
}

import { isOwnerEmail } from './owners.js';

// Free-tier numeric caps (confirmed defaults - see the plan's "Open
// decisions" section). Easy to retune later since these are just config
// values, not architecture.
export const FREE_PROJECT_LIMIT = 3;
export const FREE_EXPORT_MAX_SECONDS = 180;
export const FREE_MONTHLY_EXPORT_LIMIT = 5;
export const FREE_STORAGE_BYTES_LIMIT = 2 * 1024 * 1024 * 1024;
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// The single answer to "does this account skip free-tier limits?", used by
// every gate (export length, monthly export quota, storage, Pro-only
// resolutions, adjustment layers, project count). Owner accounts - the ones
// the app is run from, listed in OWNER_EMAILS - are always Pro, checked
// against the email rather than the stored subscription so no DB state can
// leave the owner capped.
export function isPro(user) {
  if (isOwnerEmail(user?.email)) return true;
  if (user?.subscription?.plan !== 'pro' || user?.subscription?.status === 'canceled') return false;
  // Only period-based payments (MoMo) set currentPeriodEnd; a null value
  // (card subscriptions, manual grants) means "no fixed expiry".
  const end = user.subscription.currentPeriodEnd;
  return !end || new Date(end).getTime() > Date.now();
}

// Resets the rolling 30-day export counter if it's stale, checks the
// current count against the free-tier cap, and (if allowed) increments it -
// all in one call so callers can't accidentally check-then-forget-to-increment.
// Pro users always pass without touching the counter.
export async function checkAndConsumeExportQuota(user) {
  if (isPro(user)) return { allowed: true };

  const now = Date.now();
  const periodStart = user.usage.exportsPeriodStart ? new Date(user.usage.exportsPeriodStart).getTime() : 0;
  if (now - periodStart > PERIOD_MS) {
    user.usage.exportsThisPeriod = 0;
    user.usage.exportsPeriodStart = new Date();
  }

  if (user.usage.exportsThisPeriod >= FREE_MONTHLY_EXPORT_LIMIT) {
    return { allowed: false, reason: `Free plan is limited to ${FREE_MONTHLY_EXPORT_LIMIT} exports per month. Upgrade to Pro for unlimited exports.` };
  }

  user.usage.exportsThisPeriod += 1;
  await user.save();
  return { allowed: true };
}

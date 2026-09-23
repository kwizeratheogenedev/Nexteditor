import test from 'node:test';
import assert from 'node:assert/strict';

// owners.js reads OWNER_EMAILS once at import time, so set it first.
process.env.OWNER_EMAILS = 'boss@example.com, Second@Example.com';
const { isPro, checkAndConsumeExportQuota, FREE_MONTHLY_EXPORT_LIMIT, FREE_PROJECT_LIMIT, FREE_EXPORT_MAX_SECONDS } = await import('../services/planLimits.js');

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY);

function makeUser({ email = 'user@example.com', plan = 'free', status = 'none', currentPeriodEnd = null, used = 0, periodStart = new Date() } = {}) {
  return {
    email,
    subscription: { plan, status, currentPeriodEnd },
    usage: { exportsThisPeriod: used, exportsPeriodStart: periodStart },
    saved: 0,
    async save() { this.saved += 1; },
  };
}

test('free-tier constants match what the pricing page promises', () => {
  assert.equal(FREE_PROJECT_LIMIT, 3);
  assert.equal(FREE_EXPORT_MAX_SECONDS, 180);
  assert.equal(FREE_MONTHLY_EXPORT_LIMIT, 5);
});

test('owner emails are always Pro, case-insensitively', () => {
  assert.equal(isPro(makeUser({ email: 'BOSS@example.com' })), true);
  assert.equal(isPro(makeUser({ email: 'second@example.com' })), true);
  assert.equal(isPro(makeUser({ email: 'random@example.com' })), false);
});

test('an active Pro subscription with no end date (card) stays Pro', () => {
  assert.equal(isPro(makeUser({ plan: 'pro', status: 'active' })), true);
});

test('a MoMo Pro period is Pro until it ends, then falls back to free', () => {
  assert.equal(isPro(makeUser({ plan: 'pro', status: 'active', currentPeriodEnd: inDays(10) })), true);
  assert.equal(isPro(makeUser({ plan: 'pro', status: 'active', currentPeriodEnd: inDays(-1) })), false);
});

test('a canceled subscription is not Pro', () => {
  assert.equal(isPro(makeUser({ plan: 'pro', status: 'canceled' })), false);
});

test('a free user gets exactly the monthly quota, then is refused with a clear reason', async () => {
  const user = makeUser();
  for (let i = 0; i < FREE_MONTHLY_EXPORT_LIMIT; i += 1) {
    assert.deepEqual(await checkAndConsumeExportQuota(user), { allowed: true });
  }
  const refused = await checkAndConsumeExportQuota(user);
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /Upgrade to Pro/);
  assert.equal(user.usage.exportsThisPeriod, FREE_MONTHLY_EXPORT_LIMIT, 'a refused export must not consume quota');
});

test('the monthly counter resets after 30 days', async () => {
  const user = makeUser({ used: FREE_MONTHLY_EXPORT_LIMIT, periodStart: inDays(-31) });
  assert.deepEqual(await checkAndConsumeExportQuota(user), { allowed: true });
  assert.equal(user.usage.exportsThisPeriod, 1);
});

test('Pro users are never counted or blocked', async () => {
  const user = makeUser({ plan: 'pro', status: 'active', used: 999 });
  assert.deepEqual(await checkAndConsumeExportQuota(user), { allowed: true });
  assert.equal(user.saved, 0, 'Pro exports should not write to the user record');
});

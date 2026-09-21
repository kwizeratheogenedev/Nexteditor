import express from 'express';
import { requestToPay, getRequestToPayStatus } from '../services/momoClient.js';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// Sandbox test amount - replace with the real Pro price once a production
// MoMo subscription key/currency is configured (see momoClient.js).
const PRO_PRICE_AMOUNT = process.env.MOMO_PRO_PRICE || '5';
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// Rwandan local formats (07xxxxxxxx / 7xxxxxxxx) become MSISDN 2507xxxxxxxx,
// which is what MTN expects. Anything else (already international, or a
// sandbox test number) is passed through as digits only.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^07\d{8}$/.test(digits)) return `250${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `250${digits}`;
  return digits;
}

function referenceIdFor(userId) {
  return `nexeditor-${userId}-${Date.now()}`;
}

// Each successful payment buys 30 days of Pro, stacking on any time left.
// Idempotent per payment reference so repeated polls/callbacks for the same
// payment can't extend the period more than once.
async function applyProUpgrade(user, momoPaymentRef) {
  if (user.subscription.momoLastAppliedRef === momoPaymentRef) return;
  const currentEnd = user.subscription.currentPeriodEnd ? new Date(user.subscription.currentPeriodEnd).getTime() : 0;
  const base = user.subscription.plan === 'pro' && currentEnd > Date.now() ? currentEnd : Date.now();
  user.subscription.plan = 'pro';
  user.subscription.status = 'active';
  user.subscription.momoLastAppliedRef = momoPaymentRef;
  user.subscription.currentPeriodEnd = new Date(base + PERIOD_MS);
  await user.save();
}

// Never trusts the caller: asks MTN for the payment's real state, and only
// upgrades when it was actually SUCCESSFUL, was created for this user, and
// paid the expected amount in the expected currency.
async function verifyAndApply(user, referenceId) {
  const data = await getRequestToPayStatus(referenceId);
  if (data.status !== 'SUCCESSFUL') return data;

  const ownedByUser = typeof data.externalId === 'string' && data.externalId.startsWith(`nexeditor-${user._id}-`);
  const amountOk = Number(data.amount) === Number(PRO_PRICE_AMOUNT);
  const currencyOk = !data.currency || data.currency === (process.env.MOMO_CURRENCY || 'EUR');
  if (!ownedByUser || !amountOk || !currencyOk) {
    console.warn('MoMo payment did not match expected user/amount/currency:', { referenceId, externalId: data.externalId, amount: data.amount, currency: data.currency });
    return { status: 'FAILED', reason: 'PAYMENT_MISMATCH' };
  }
  await applyProUpgrade(user, referenceId);
  return data;
}

router.post('/request-to-pay', requireAuth, async (req, res) => {
  const phoneNumber = normalizePhone(req.body?.phoneNumber);
  if (!/^\d{9,15}$/.test(phoneNumber)) {
    res.status(400).json({ error: 'Enter a valid mobile money number, e.g. 0788123456.' });
    return;
  }
  try {
    const { referenceId } = await requestToPay({
      amount: PRO_PRICE_AMOUNT,
      phoneNumber,
      externalId: referenceIdFor(req.user._id),
      payerMessage: 'NexEditor Pro upgrade',
    });
    req.user.subscription.momoPaymentRef = referenceId;
    await req.user.save();
    res.json({ referenceId });
  } catch (err) {
    console.error('MoMo request-to-pay failed:', err);
    const status = err.code === 'NOT_CONFIGURED' ? 500 : 502;
    res.status(status).json({ error: err.message || 'Failed to start MoMo payment.' });
  }
});

router.get('/status/:referenceId', requireAuth, async (req, res) => {
  // Only the payment this user started - a different reference would let one
  // account claim another account's successful payment.
  if (req.params.referenceId !== req.user.subscription.momoPaymentRef) {
    res.status(404).json({ error: 'Unknown payment reference.' });
    return;
  }
  try {
    const data = await verifyAndApply(req.user, req.params.referenceId);
    res.json({ status: data.status, reason: data.reason || null });
  } catch (err) {
    console.error('MoMo status check failed:', err);
    res.status(502).json({ error: err.message || 'Failed to check payment status.' });
  }
});

// MTN calls this when a public callback URL is configured (MOMO_CALLBACK_URL,
// sent as X-Callback-Url on each request) - not reachable from a plain
// localhost dev server, so `/status/:referenceId` polling is the primary path
// in dev. The body is NOT trusted: it's only used to find the user, then the
// payment is re-verified directly with MTN. Always acknowledges with 200 so
// MTN doesn't retry indefinitely.
router.post('/callback', async (req, res) => {
  try {
    const externalId = req.body?.externalId;
    const match = typeof externalId === 'string' ? /^nexeditor-([a-f0-9]{24})-/.exec(externalId) : null;
    if (match) {
      const user = await User.findById(match[1]);
      const referenceId = user?.subscription?.momoPaymentRef;
      if (user && referenceId) await verifyAndApply(user, referenceId);
    }
  } catch (err) {
    console.error('MoMo callback handling failed:', err);
  }
  res.status(200).json({ ok: true });
});

export default router;

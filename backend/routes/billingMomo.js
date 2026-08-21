import express from 'express';
import { requestToPay, getRequestToPayStatus } from '../services/momoClient.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Sandbox test amount - replace with the real Pro price once a production
// MoMo subscription key/currency is configured (see momoClient.js).
const PRO_PRICE_AMOUNT = process.env.MOMO_PRO_PRICE || '5';

function applyProUpgrade(user, momoPaymentRef) {
  user.subscription.plan = 'pro';
  user.subscription.status = 'active';
  user.subscription.momoPaymentRef = momoPaymentRef;
  return user.save();
}

router.post('/request-to-pay', requireAuth, async (req, res) => {
  const { phoneNumber } = req.body || {};
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    res.status(400).json({ error: 'A valid phone number is required.' });
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

function referenceIdFor(userId) {
  return `nexeditor-${userId}-${Date.now()}`;
}

router.get('/status/:referenceId', requireAuth, async (req, res) => {
  try {
    const data = await getRequestToPayStatus(req.params.referenceId);
    if (data.status === 'SUCCESSFUL' && req.user.subscription.plan !== 'pro') {
      await applyProUpgrade(req.user, req.params.referenceId);
    }
    res.json({ status: data.status, reason: data.reason || null });
  } catch (err) {
    console.error('MoMo status check failed:', err);
    res.status(502).json({ error: err.message || 'Failed to check payment status.' });
  }
});

// MTN calls this when a public callback URL is configured (MOMO_CALLBACK_URL
// at provisioning time) - not reachable from a plain localhost dev server,
// so `/status/:referenceId` polling above is the primary path in dev. Always
// acknowledges with 200 so MTN doesn't retry indefinitely, even if the
// payload can't be matched to a user.
router.post('/callback', async (req, res) => {
  try {
    const { status, externalId } = req.body || {};
    // externalId encodes the user id (see referenceIdFor) so the right user
    // can be found without depending on momoPaymentRef, which gets
    // overwritten on every new attempt and wouldn't reliably identify which
    // user a given callback belongs to.
    const match = status === 'SUCCESSFUL' && externalId ? /^nexeditor-([a-f0-9]{24})-/.exec(externalId) : null;
    if (match) {
      const User = (await import('../models/User.js')).default;
      const targetUser = await User.findById(match[1]);
      if (targetUser && targetUser.subscription.plan !== 'pro') {
        await applyProUpgrade(targetUser, externalId);
      }
    }
  } catch (err) {
    console.error('MoMo callback handling failed:', err);
  }
  res.status(200).json({ ok: true });
});

export default router;

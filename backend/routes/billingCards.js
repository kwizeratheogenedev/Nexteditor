import express from 'express';
import { randomUUID } from 'crypto';
import { createCheckoutSession, verifyTransaction, CURRENCY, PRO_PRICE_AMOUNT } from '../services/flutterwaveClient.js';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

function txRefFor(userId) {
  return `nexeditor-${userId}-${randomUUID()}`;
}

function userIdFromTxRef(txRef) {
  const match = /^nexeditor-([a-f0-9]{24})-/.exec(txRef || '');
  return match ? match[1] : null;
}

async function applyProUpgrade(user, cardCustomerId) {
  user.subscription.plan = 'pro';
  user.subscription.status = 'active';
  user.subscription.cardCustomerId = cardCustomerId;
  await user.save();
}

router.post('/checkout-session', requireAuth, async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const txRef = txRefFor(req.user._id);
    const { checkoutUrl } = await createCheckoutSession({
      txRef,
      email: req.user.email,
      name: req.user.name || req.user.email,
      redirectUrl: `${frontendUrl}/pricing`,
    });
    res.json({ checkoutUrl, txRef });
  } catch (err) {
    console.error('Flutterwave checkout creation failed:', err);
    const status = err.code === 'NOT_CONFIGURED' ? 500 : 502;
    res.status(status).json({ error: err.message || 'Failed to start card payment.' });
  }
});

// Called by the frontend after Flutterwave redirects back with
// ?status=...&tx_ref=...&transaction_id=... - always re-verifies against
// Flutterwave's own API rather than trusting the redirect query params,
// which a client could tamper with.
router.get('/verify', requireAuth, async (req, res) => {
  const { transaction_id: transactionId, tx_ref: txRef } = req.query;
  if (!transactionId || !txRef) {
    res.status(400).json({ error: 'Missing transaction reference.' });
    return;
  }
  const ownerId = userIdFromTxRef(String(txRef));
  if (!ownerId || ownerId !== String(req.user._id)) {
    res.status(403).json({ error: 'This transaction does not belong to your account.' });
    return;
  }
  try {
    const transaction = await verifyTransaction(transactionId);
    const amountOk = Number(transaction.amount) >= Number(PRO_PRICE_AMOUNT) && transaction.currency === CURRENCY;
    if (transaction.status === 'successful' && amountOk && transaction.tx_ref === txRef) {
      await applyProUpgrade(req.user, String(transaction.customer?.id || transactionId));
      res.json({ status: 'success' });
      return;
    }
    res.json({ status: 'failed' });
  } catch (err) {
    console.error('Flutterwave verification failed:', err);
    res.status(502).json({ error: err.message || 'Failed to verify payment.' });
  }
});

// Server-to-server confirmation for when a public webhook URL is configured
// in the Flutterwave dashboard - verif-hash must match FLW_SECRET_HASH
// (set on the dashboard's webhook settings page), or the request is rejected
// outright. Not reachable from a plain localhost dev server, so `/verify`
// above (driven by the redirect) is the primary path in dev.
router.post('/webhook', async (req, res) => {
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== process.env.FLW_SECRET_HASH) {
    res.status(401).end();
    return;
  }
  try {
    const { data } = req.body || {};
    const ownerId = userIdFromTxRef(data?.tx_ref);
    if (data?.status === 'successful' && ownerId) {
      const user = await User.findById(ownerId);
      if (user && user.subscription.plan !== 'pro') {
        // Re-verify server-side rather than trusting the webhook payload directly.
        const transaction = await verifyTransaction(data.id);
        if (transaction.status === 'successful') {
          await applyProUpgrade(user, String(transaction.customer?.id || data.id));
        }
      }
    }
  } catch (err) {
    console.error('Flutterwave webhook handling failed:', err);
  }
  res.status(200).json({ ok: true });
});

export default router;

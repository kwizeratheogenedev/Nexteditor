import Payment from '../models/Payment.js';
import { logger } from './logger.js';

// Records a successful payment. Never throws: a payment that was really made
// must still upgrade the user even if writing the history row fails, so a
// failure here is only logged. Duplicate (provider, reference) pairs are
// ignored, which makes this safe to call from every confirmation path.
export async function recordPayment({ user, provider, reference, amount, currency, periodEnd = null, note = '', createdBy = null }) {
  try {
    await Payment.updateOne(
      { provider, reference: String(reference) },
      {
        $setOnInsert: {
          user: user?._id || null,
          userEmail: user?.email || '',
          provider,
          reference: String(reference),
          amount: Number(amount) || 0,
          currency: currency || '',
          status: 'successful',
          periodEnd,
          note,
          createdBy,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.error('Failed to record payment', { provider, reference, err });
  }
}

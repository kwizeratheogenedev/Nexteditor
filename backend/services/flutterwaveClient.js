// Flutterwave "Standard" hosted checkout (redirect-based, like Stripe
// Checkout) - simplest integration surface, no card data ever touches our
// server. Docs: https://developer.flutterwave.com/docs/collecting-payments/standard
const BASE_URL = 'https://api.flutterwave.com/v3';

function isConfigured() {
  return Boolean(process.env.FLW_SECRET_KEY);
}

const CURRENCY = process.env.FLW_CURRENCY || 'RWF';
const PRO_PRICE_AMOUNT = process.env.FLW_PRO_PRICE || '5000';

export async function createCheckoutSession({ txRef, email, name, redirectUrl }) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Card payments aren\'t configured yet - add FLW_SECRET_KEY to backend/.env.'), { code: 'NOT_CONFIGURED' });
  }
  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tx_ref: txRef,
      amount: PRO_PRICE_AMOUNT,
      currency: CURRENCY,
      redirect_url: redirectUrl,
      customer: { email, name },
      customizations: { title: 'NexEditor Pro', description: 'Upgrade to NexEditor Pro' },
    }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(data.message || `Flutterwave checkout creation failed (${res.status})`);
  }
  return { checkoutUrl: data.data.link };
}

export async function verifyTransaction(transactionId) {
  const res = await fetch(`${BASE_URL}/transactions/${transactionId}/verify`, {
    headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(data.message || `Flutterwave verification failed (${res.status})`);
  }
  return data.data; // { status: 'successful'|..., amount, currency, tx_ref, ... }
}

export { isConfigured as isFlutterwaveConfigured, CURRENCY, PRO_PRICE_AMOUNT };

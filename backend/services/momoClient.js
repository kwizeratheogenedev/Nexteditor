import { randomUUID } from 'crypto';

// MTN Mobile Money Open API (Collections product - Request to Pay). Sandbox
// docs/setup: https://momodeveloper.mtn.com - a subscription key is issued
// per-product when you subscribe to "Collections" on the developer portal;
// the API user/API key (MOMO_API_USER/MOMO_API_KEY) are a one-time
// provisioning step done via the same portal's sandbox provisioning tool
// (or the /v1_0/apiuser + /v1_0/apiuser/{id}/apikey endpoints), not created
// per-request.
const BASE_URL = process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';

let cachedToken = null; // { value, expiresAt }

function isConfigured() {
  return Boolean(process.env.MOMO_SUBSCRIPTION_KEY && process.env.MOMO_API_USER && process.env.MOMO_API_KEY);
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  const basicAuth = Buffer.from(`${process.env.MOMO_API_USER}:${process.env.MOMO_API_KEY}`).toString('base64');
  const res = await fetch(`${BASE_URL}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Ocp-Apim-Subscription-Key': process.env.MOMO_SUBSCRIPTION_KEY,
    },
  });
  if (!res.ok) throw new Error(`MoMo auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

// Sandbox only ever accepts "EUR" regardless of the merchant's real market -
// production accounts are provisioned with the merchant's actual currency
// (e.g. RWF), which should replace this once a production subscription key
// is in use.
const CURRENCY = process.env.MOMO_CURRENCY || 'EUR';

export async function requestToPay({ amount, phoneNumber, externalId, payerMessage }) {
  if (!isConfigured()) {
    throw Object.assign(new Error('MTN MoMo isn\'t configured yet - add MOMO_SUBSCRIPTION_KEY, MOMO_API_USER and MOMO_API_KEY to backend/.env.'), { code: 'NOT_CONFIGURED' });
  }
  const referenceId = randomUUID();
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': process.env.MOMO_SUBSCRIPTION_KEY,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: String(amount),
      currency: CURRENCY,
      externalId,
      payer: { partyIdType: 'MSISDN', partyId: phoneNumber },
      payerMessage: payerMessage || 'NexEditor Pro upgrade',
      payeeNote: 'NexEditor Pro upgrade',
    }),
  });
  if (!res.ok) throw new Error(`MoMo request-to-pay failed (${res.status}): ${await res.text()}`);
  return { referenceId };
}

export async function getRequestToPayStatus(referenceId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': process.env.MOMO_SUBSCRIPTION_KEY,
      'X-Target-Environment': process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox',
    },
  });
  if (!res.ok) throw new Error(`MoMo status check failed (${res.status}): ${await res.text()}`);
  return res.json(); // { status: 'PENDING'|'SUCCESSFUL'|'FAILED', ... }
}

export { isConfigured as isMomoConfigured };

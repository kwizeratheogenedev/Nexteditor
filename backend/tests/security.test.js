import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { securityHeaders, applyRateLimits } from '../middleware/security.js';

async function withApp(limits, routes, fn) {
  const app = express();
  app.use(securityHeaders);
  applyRateLimits(app, limits);
  routes(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const big = 100000;
const post = (url) => fetch(url, { method: 'POST' });

test('sets security headers and hides X-Powered-By', async () => {
  await withApp({}, (app) => app.get('/api/ping', (_q, r) => r.json({ ok: true })), async (base) => {
    const res = await fetch(`${base}/api/ping`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  });
});

test('failed logins are limited, successful ones are not counted', async () => {
  const limits = { general: big, heavy: big, payment: big, signups: big, loginFails: 3 };
  await withApp(limits, (app) => {
    app.post('/api/auth/login', (req, res) => res.status(req.query.ok ? 200 : 401).json({}));
  }, async (base) => {
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await post(`${base}/api/auth/login?ok=1`)).status, 200, 'successes never trip the limit');
    }
    for (let i = 0; i < 3; i += 1) assert.equal((await post(`${base}/api/auth/login`)).status, 401);
    const blocked = await post(`${base}/api/auth/login`);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, 'RATE_LIMITED');
  });
});

test('heavy render/upload POSTs are limited but polling never is', async () => {
  const limits = { general: 3, heavy: 2, payment: big, loginFails: big, signups: big };
  await withApp(limits, (app) => {
    app.post('/api/create-montage', (_q, r) => r.status(202).json({}));
    app.get('/api/create-montage/progress/:id', (_q, r) => r.json({ percent: 5 }));
  }, async (base) => {
    assert.equal((await post(`${base}/api/create-montage`)).status, 202);
    assert.equal((await post(`${base}/api/create-montage`)).status, 202);
    assert.equal((await post(`${base}/api/create-montage`)).status, 429);
    for (let i = 0; i < 20; i += 1) {
      assert.equal((await fetch(`${base}/api/create-montage/progress/abc`)).status, 200, 'progress polling is exempt');
    }
  });
});

test('payment attempts are limited but provider callbacks are not', async () => {
  const limits = { general: big, heavy: big, payment: 2, loginFails: big, signups: big };
  await withApp(limits, (app) => {
    app.post('/api/billing/momo/request-to-pay', (_q, r) => r.json({}));
    app.post('/api/billing/momo/callback', (_q, r) => r.json({ ok: true }));
  }, async (base) => {
    assert.equal((await post(`${base}/api/billing/momo/request-to-pay`)).status, 200);
    assert.equal((await post(`${base}/api/billing/momo/request-to-pay`)).status, 200);
    assert.equal((await post(`${base}/api/billing/momo/request-to-pay`)).status, 429);
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await post(`${base}/api/billing/momo/callback`)).status, 200, 'MTN callbacks must never be blocked');
    }
  });
});

test('signups are limited per hour', async () => {
  const limits = { general: big, heavy: big, payment: big, loginFails: big, signups: 2 };
  await withApp(limits, (app) => app.post('/api/auth/signup', (_q, r) => r.json({})), async (base) => {
    assert.equal((await post(`${base}/api/auth/signup`)).status, 200);
    assert.equal((await post(`${base}/api/auth/signup`)).status, 200);
    assert.equal((await post(`${base}/api/auth/signup`)).status, 429);
  });
});

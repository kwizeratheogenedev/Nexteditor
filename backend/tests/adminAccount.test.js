import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

// No real database: every model call these routes make is stubbed below, and
// buffering is off so an un-stubbed call fails loudly instead of hanging.
process.env.JWT_SECRET = 'test-secret';
process.env.OWNER_EMAILS = 'owner@example.com';
mongoose.set('bufferCommands', false);

const { default: User } = await import('../models/User.js');
const { default: Project } = await import('../models/Project.js');
const { default: Job } = await import('../models/Job.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: AdminAction } = await import('../models/AdminAction.js');
const { default: accountRouter } = await import('../routes/account.js');
const { default: adminRouter } = await import('../routes/admin.js');
const { extendProPeriod, grantLifetimePro, proDaysLeft } = await import('../services/subscription.js');
const { isAdmin } = await import('../services/roles.js');

const store = new Map();
const actions = [];
const deleted = [];
User.prototype.save = async function save() { store.set(String(this._id), this); return this; };
User.findById = async (id) => store.get(String(id)) || null;
User.deleteOne = async ({ _id }) => { deleted.push(String(_id)); store.delete(String(_id)); return {}; };
Project.countDocuments = async () => 0;
Project.deleteMany = async () => ({ deletedCount: 2 });
Job.deleteMany = async () => ({ deletedCount: 3 });
Payment.updateMany = async () => ({});
AdminAction.create = async (doc) => { actions.push(doc); return doc; };

function makeUser(fields) {
  const user = new User({ name: '', authProviders: ['local'], ...fields });
  store.set(String(user._id), user);
  return user;
}

const cookieFor = (user) => `nexeditor_session=${jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET)}`;

async function withServer(fn) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/account', accountRouter);
  app.use('/api/admin', adminRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, user, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: cookieFor(user) } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try { await fn(call); } finally { await new Promise((r) => server.close(r)); }
}

const passwordHash = await bcrypt.hash('correct-horse', 4);
const admin = makeUser({ email: 'admin@example.com', role: 'admin', passwordHash });
const owner = makeUser({ email: 'owner@example.com' });
const regular = makeUser({ email: 'user@example.com', passwordHash });

test('roles: role admin and OWNER_EMAILS are admins, everyone else is not', () => {
  assert.equal(isAdmin(admin), true);
  assert.equal(isAdmin(owner), true);
  assert.equal(isAdmin(regular), false);
});

test('Pro periods stack, and lifetime Pro is never shortened', () => {
  const u = new User({ email: 'p@example.com' });
  const now = Date.now();
  extendProPeriod(u, 30, now);
  extendProPeriod(u, 30, now);
  assert.equal(proDaysLeft(u, now), 60);
  grantLifetimePro(u);
  assert.equal(extendProPeriod(u, 30, now), null);
  assert.equal(u.subscription.currentPeriodEnd, null);
});

test('the admin API is closed to signed-out and regular users', async () => {
  await withServer(async (call) => {
    assert.equal((await call('GET', '/api/admin/users/x')).status, 401);
    const res = await call('GET', `/api/admin/users/${regular._id}`, regular);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'ADMIN_REQUIRED');
  });
});

test('suspended users are blocked everywhere, and admins can lift it', async () => {
  const victim = makeUser({ email: 'victim@example.com' });
  await withServer(async (call) => {
    const s = await call('POST', `/api/admin/users/${victim._id}/suspend`, admin, { reason: 'spam' });
    assert.equal(s.status, 200);
    assert.equal(s.body.user.status, 'suspended');
    const blocked = await call('GET', '/api/account', victim);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'ACCOUNT_SUSPENDED');
    assert.equal((await call('POST', `/api/admin/users/${victim._id}/unsuspend`, admin)).status, 200);
    assert.equal((await call('GET', '/api/account', victim)).status, 200);
  });
  assert.ok(actions.some((a) => a.action === 'user.suspend' && a.targetEmail === 'victim@example.com'));
});

test('admins cannot suspend, demote or delete themselves or an owner', async () => {
  await withServer(async (call) => {
    assert.equal((await call('POST', `/api/admin/users/${admin._id}/suspend`, admin)).status, 400);
    assert.equal((await call('PATCH', `/api/admin/users/${admin._id}/role`, admin, { role: 'user' })).status, 400);
    assert.equal((await call('DELETE', `/api/admin/users/${admin._id}`, admin)).status, 400);
    assert.equal((await call('POST', `/api/admin/users/${owner._id}/suspend`, admin)).status, 400);
    assert.equal((await call('DELETE', `/api/admin/users/${owner._id}`, admin)).status, 400);
    assert.equal((await call('DELETE', `/api/admin/users/${owner._id}/pro`, admin)).status, 400);
  });
});

test('admins can grant Pro for N days, promote users and reset quotas', async () => {
  const u = makeUser({ email: 'grant@example.com', usage: { exportsThisPeriod: 5 } });
  await withServer(async (call) => {
    const g = await call('POST', `/api/admin/users/${u._id}/pro`, admin, { days: 10 });
    assert.equal(g.status, 200);
    assert.equal(g.body.user.isPro, true);
    assert.equal(proDaysLeft(u), 10);
    assert.equal((await call('POST', `/api/admin/users/${u._id}/pro`, admin, { days: 0 })).status, 400);
    assert.equal((await call('PATCH', `/api/admin/users/${u._id}/role`, admin, { role: 'admin' })).body.user.isAdmin, true);
    assert.equal((await call('POST', `/api/admin/users/${u._id}/reset-quota`, admin)).status, 200);
    assert.equal(u.usage.exportsThisPeriod, 0);
    assert.equal((await call('DELETE', `/api/admin/users/${u._id}/pro`, admin)).body.user.isPro, false);
  });
});

test('the account API shows plan and usage without leaking secrets', async () => {
  await withServer(async (call) => {
    const res = await call('GET', '/api/account', regular);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'user@example.com');
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.hasPassword, true);
    assert.equal(res.body.plan.isPro, false);
    assert.equal(res.body.usage.exports.limit, 5);
  });
});

test('changing the password requires the current one', async () => {
  const u = makeUser({ email: 'pw@example.com', passwordHash });
  await withServer(async (call) => {
    assert.equal((await call('POST', '/api/account/password', u, { currentPassword: 'wrong', newPassword: 'new-password-1' })).status, 400);
    assert.equal((await call('POST', '/api/account/password', u, { currentPassword: 'correct-horse', newPassword: 'short' })).status, 400);
    assert.equal((await call('POST', '/api/account/password', u, { currentPassword: 'correct-horse', newPassword: 'new-password-1' })).status, 200);
  });
  assert.equal(await bcrypt.compare('new-password-1', u.passwordHash), true);
});

test('deleting your own account needs the password, then removes it', async () => {
  const u = makeUser({ email: 'bye@example.com', passwordHash });
  await withServer(async (call) => {
    assert.equal((await call('DELETE', '/api/account', u, { password: 'nope' })).status, 400);
    const ok = await call('DELETE', '/api/account', u, { password: 'correct-horse' });
    assert.equal(ok.status, 200);
  });
  assert.ok(deleted.includes(String(u._id)));
});

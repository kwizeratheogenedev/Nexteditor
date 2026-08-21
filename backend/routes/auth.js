import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import User from '../models/User.js';
import { requireAuth, ensureOwnerAccess } from '../middleware/auth.js';

const router = express.Router();

const isDev = process.env.NODE_ENV !== 'production';
const SESSION_COOKIE = 'nexeditor_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function issueSession(res, user) {
  const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !isDev,
    sameSite: isDev ? 'lax' : 'none',
    maxAge: SESSION_MAX_AGE_MS,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
}

function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { domain: process.env.COOKIE_DOMAIN || undefined });
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: normalizedEmail,
      passwordHash,
      name: (name || '').trim(),
      authProviders: ['local'],
    });
    await ensureOwnerAccess(user);
    issueSession(res, user);
    res.status(201).json({ user });
  } catch (err) {
    console.error('Signup failed:', err);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== 'string') {
    res.status(400).json({ error: 'Enter your email and password.' });
    return;
  }
  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Incorrect email or password.' });
      return;
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      res.status(401).json({ error: 'Incorrect email or password.' });
      return;
    }
    await ensureOwnerAccess(user);
    issueSession(res, user);
    res.json({ user });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.json({ user: null });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (user) await ensureOwnerAccess(user);
    res.json({ user: user || null });
  } catch (_err) {
    res.json({ user: null });
  }
});

// Separate OAuth client/scopes from the YouTube-upload connection in
// routes/youtube.js - login only ever asks for identity, never channel
// upload access, so the Google consent screen doesn't over-request.
const LOGIN_SCOPES = ['openid', 'email', 'profile'];

function getLoginOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_LOGIN_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

router.get('/google/url', (req, res) => {
  const oauth2Client = getLoginOAuthClient();
  if (!oauth2Client) {
    res.status(500).json({
      error: 'Google sign-in isn\'t configured yet - add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_LOGIN_REDIRECT_URI to backend/.env, then restart the server.',
    });
    return;
  }
  const url = oauth2Client.generateAuthUrl({
    access_type: 'online',
    scope: LOGIN_SCOPES,
    prompt: 'select_account',
  });
  res.json({ url });
});

router.get('/google/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const { code, error } = req.query;
  if (error) {
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(String(error))}`);
    return;
  }
  const oauth2Client = getLoginOAuthClient();
  if (!oauth2Client || !code) {
    res.redirect(`${frontendUrl}/login?error=google_not_configured`);
    return;
  }
  try {
    const { tokens } = await oauth2Client.getToken(String(code));
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();
    if (!profile.email) {
      res.redirect(`${frontendUrl}/login?error=no_email`);
      return;
    }
    const normalizedEmail = profile.email.trim().toLowerCase();
    let user = await User.findOne({ $or: [{ googleId: profile.id }, { email: normalizedEmail }] });
    if (user) {
      if (!user.googleId) user.googleId = profile.id;
      if (!user.authProviders.includes('google')) user.authProviders.push('google');
      if (!user.name) user.name = profile.name || '';
      if (!user.avatarUrl) user.avatarUrl = profile.picture || '';
      await user.save();
    } else {
      user = await User.create({
        email: normalizedEmail,
        googleId: profile.id,
        name: profile.name || '',
        avatarUrl: profile.picture || '',
        authProviders: ['google'],
      });
    }
    await ensureOwnerAccess(user);
    issueSession(res, user);
    res.redirect(`${frontendUrl}/auth/callback`);
  } catch (err) {
    console.error('Google sign-in failed:', err);
    res.redirect(`${frontendUrl}/login?error=google_failed`);
  }
});

export default router;
export { requireAuth };

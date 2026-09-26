import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

// Security headers + rate limits for the API.
//
// Rate limits are per client IP. Behind a reverse proxy / hosting platform
// (Render, Fly, nginx, Cloudflare...) set TRUST_PROXY=1 (the number of proxy
// hops in front of the app) - otherwise every user shares the proxy's IP and
// they all get limited together. Leave it unset when the app is reached
// directly, so a client can't spoof its address with a fake X-Forwarded-For.
//
// Limits (all overridable via env):
//   RATE_LIMIT_GENERAL          all /api calls per 15 min           (3000)
//   RATE_LIMIT_HEAVY_PER_HOUR   upload/render POSTs per hour        (60)
//   RATE_LIMIT_PAYMENT_PER_HOUR payment POSTs per hour              (20)
//   RATE_LIMIT_LOGIN_FAILS      failed logins per 15 min            (15)
//   RATE_LIMIT_SIGNUP_PER_HOUR  signups per hour                    (20)
// Progress/status polling, health checks and payment-provider callbacks are
// never counted, so a long render or a provider retry can't lock a user out.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const securityHeaders = helmet({
  // This server only returns JSON and video files, never HTML pages.
  contentSecurityPolicy: false,
  // Finished renders under /clips are played by the frontend, which is a
  // different origin - the default same-origin policy would block them.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
});

export function configureProxyTrust(app) {
  const raw = process.env.TRUST_PROXY;
  if (!raw) {
    // Vercel and Render each put exactly one proxy in front of the app.
    // Without trusting it every visitor looks like the proxy's IP (one shared
    // rate limit) and express-rate-limit logs a ValidationError per request.
    if (process.env.VERCEL || process.env.RENDER) app.set('trust proxy', 1);
    return;
  }
  const hops = Number(raw);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : raw);
}

const HEAVY_PATHS = [
  '/api/convert',
  '/api/burn-subtitles',
  '/api/generate-captions',
  '/api/extract-shorts',
  '/api/reformat-short',
  '/api/fetch-url-video',
  '/api/fetch-url',
  '/api/create-montage',
  '/api/editor/export',
  '/api/editor/captions',
];

function isPolling(req) {
  const url = req.originalUrl || '';
  return req.method === 'OPTIONS'
    || url.includes('/progress/')
    || url.includes('/status/')
    || url.startsWith('/health');
}

function isProviderCallback(req) {
  const url = req.originalUrl || '';
  return url.includes('/callback') || url.includes('/webhook');
}

function limiter({ windowMs, limit, skip, skipSuccessfulRequests = false, message }) {
  return rateLimit({
    windowMs,
    limit,
    skip,
    skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: message || 'Too many requests. Please wait a moment and try again.',
        code: 'RATE_LIMITED',
      });
    },
  });
}

export function applyRateLimits(app, overrides = {}) {
  const general = overrides.general ?? envNumber('RATE_LIMIT_GENERAL', 3000);
  const heavy = overrides.heavy ?? envNumber('RATE_LIMIT_HEAVY_PER_HOUR', 60);
  const payment = overrides.payment ?? envNumber('RATE_LIMIT_PAYMENT_PER_HOUR', 20);
  const loginFails = overrides.loginFails ?? envNumber('RATE_LIMIT_LOGIN_FAILS', 15);
  const signups = overrides.signups ?? envNumber('RATE_LIMIT_SIGNUP_PER_HOUR', 20);

  // Most specific first.
  app.use('/api/auth/login', limiter({
    windowMs: 15 * MIN,
    limit: loginFails,
    // Only failed attempts count, so a school or cafe sharing one IP isn't
    // locked out by its own successful logins - just by guessing.
    skipSuccessfulRequests: true,
    skip: (req) => req.method !== 'POST',
    message: 'Too many failed login attempts. Please wait 15 minutes and try again.',
  }));

  // Password checks outside login (change password, delete account, admin
  // password resets) - same failed-attempts budget as login, so they can't be
  // used to guess a password instead.
  app.use('/api/account', limiter({
    windowMs: 15 * MIN,
    limit: loginFails,
    skipSuccessfulRequests: true,
    skip: (req) => !(req.method === 'POST' || req.method === 'DELETE'),
    message: 'Too many failed attempts. Please wait 15 minutes and try again.',
  }));

  app.use('/api/auth/signup', limiter({
    windowMs: HOUR,
    limit: signups,
    skip: (req) => req.method !== 'POST',
    message: 'Too many sign-ups from this network. Please try again later.',
  }));

  app.use('/api/billing', limiter({
    windowMs: HOUR,
    limit: payment,
    skip: (req) => req.method !== 'POST' || isProviderCallback(req),
    message: 'Too many payment attempts. Please wait a while and try again.',
  }));

  app.use(HEAVY_PATHS, limiter({
    windowMs: HOUR,
    limit: heavy,
    skip: (req) => req.method !== 'POST',
    message: 'You have started a lot of renders in the last hour. Please wait a bit before starting another.',
  }));

  app.use('/api', limiter({
    windowMs: 15 * MIN,
    limit: general,
    skip: (req) => isPolling(req) || isProviderCallback(req),
  }));
}

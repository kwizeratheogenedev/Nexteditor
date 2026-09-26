import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { AREAS, categorizeSource, deviceFromUserAgent, recordPing } from '../services/analytics.js';
import { logger } from '../services/logger.js';

// POST /api/analytics/ping - the browser's "I'm here" signal, sent about
// once a minute while a NexEditor tab is open and visible. Works signed in
// or not (anonymous visitors are just a random id from their browser).
const router = express.Router();

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp\//i;
const VISITOR_ID = /^[A-Za-z0-9-]{16,64}$/;

router.post('/ping', optionalAuth, async (req, res) => {
  const { visitorId, area, referrer, utm, isNew } = req.body || {};
  const ua = req.headers['user-agent'] || '';
  if (typeof visitorId !== 'string' || !VISITOR_ID.test(visitorId) || BOT_UA.test(ua)) {
    res.status(204).end();
    return;
  }
  const ownHost = String(req.headers.host || '').split(':')[0];
  try {
    await recordPing({
      visitorId,
      userId: req.user?._id || null,
      area: AREAS.includes(area) ? area : 'other',
      device: deviceFromUserAgent(ua),
      source: categorizeSource(referrer, utm, ownHost),
      referrerHost: typeof referrer === 'string' ? referrer : '',
      isNewVisitor: isNew === true,
    });
  } catch (err) {
    logger.warn('Analytics ping failed', { err });
  }
  res.status(204).end();
});

export default router;

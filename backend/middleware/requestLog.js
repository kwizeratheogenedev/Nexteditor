import { randomUUID } from 'crypto';
import { logger as defaultLogger } from '../services/logger.js';
import { recordRequest } from '../services/analytics.js';

// Gives every request an id (returned in the X-Request-Id header so a user
// can quote it in a bug report) and logs what matters without drowning the
// log in noise:
//   - failed requests (4xx warn, 5xx error)
//   - state-changing calls (POST/PUT/PATCH/DELETE)
//   - slow ordinary requests
// Progress/status polling, health checks and static video fetches are skipped
// unless they fail.
export function requestLogger({ log = defaultLogger, slowMs = 5000, onFinish = recordRequest } = {}) {
  return function requestLog(req, res, next) {
    const id = String(req.headers['x-request-id'] || randomUUID().slice(0, 8)).slice(0, 64);
    req.id = id;
    res.setHeader('X-Request-Id', id);
    const started = process.hrtime.bigint();

    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      const url = req.originalUrl || req.url;
      const status = res.statusCode;
      const noisy = url.startsWith('/health') || url.startsWith('/clips') || url.includes('/progress/') || url.includes('/status/') || url.startsWith('/api/analytics/ping');
      const changesState = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
      const isUpload = String(req.headers['content-type'] || '').startsWith('multipart/');
      const slow = ms > slowMs && !isUpload;

      // Server-speed metrics for the admin Analytics page - API calls only,
      // minus the polling and analytics pings that would swamp the numbers.
      if (url.startsWith('/api/') && !noisy) onFinish({ status, ms, slow });

      const ctx = { id, method: req.method, url, status, ms, user: req.user?._id ? String(req.user._id) : undefined };
      if (status >= 500) log.error('request failed', ctx);
      else if (status >= 400) log.warn('request rejected', ctx);
      else if (slow) log.warn('slow request', ctx);
      else if (changesState && !noisy) log.info('request', ctx);
    });

    next();
  };
}

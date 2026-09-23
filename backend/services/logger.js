// Small structured logger. Human-readable lines in development, one JSON
// object per line in production (or LOG_FORMAT=json) so a hosting platform's
// log viewer can filter by level, job id or user id.
//
//   LOG_LEVEL   debug | info | warn | error   (default: info)
//   LOG_FORMAT  json | pretty                 (default: json in production)

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  return { name: err.name, message: err.message, stack: err.stack, code: err.code };
}

function normalize(ctx) {
  const out = {};
  for (const [key, value] of Object.entries(ctx || {})) {
    out[key] = key === 'err' || key === 'error' ? serializeError(value) : value;
  }
  return out;
}

export function createLogger({ level = process.env.LOG_LEVEL, format = process.env.LOG_FORMAT, sink = console } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const asJson = format ? format === 'json' : process.env.NODE_ENV === 'production';

  function write(name, msg, ctx) {
    if (LEVELS[name] < min) return;
    const fields = normalize(ctx);
    const stream = LEVELS[name] >= LEVELS.warn ? sink.error : sink.log;
    if (asJson) {
      stream.call(sink, JSON.stringify({ time: new Date().toISOString(), level: name, msg, ...fields }));
      return;
    }
    const extra = Object.keys(fields).length
      ? ` ${JSON.stringify(fields, (k, v) => (k === 'stack' ? undefined : v))}`
      : '';
    stream.call(sink, `[${name.toUpperCase()}] ${msg}${extra}`);
    if (fields.err?.stack) stream.call(sink, fields.err.stack);
  }

  return {
    debug: (msg, ctx) => write('debug', msg, ctx),
    info: (msg, ctx) => write('info', msg, ctx),
    warn: (msg, ctx) => write('warn', msg, ctx),
    error: (msg, ctx) => write('error', msg, ctx),
  };
}

export const logger = createLogger();

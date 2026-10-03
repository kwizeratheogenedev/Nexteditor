import Operation from '../models/Operation.js';
import { isDBConnected } from '../db.js';
import { toUserMessage } from './userMessage.js';

// Records every server operation for the admin dashboard (models/Operation.js).
//
// trackOperation(kind) is route middleware, placed after the upload parser
// (so the upload size is known) and after auth (so the user is known - guests
// are recorded with no owner). It works out the result from the response:
//   - 2xx: done; 4xx/5xx: failed, with the `error` the route sent the user;
//   - 202 (a background job, e.g. montage): the route reports the end itself
//     through req.operation.done() / req.operation.fail(error);
//   - connection dropped before an answer: failed.
// Recording never affects the request: database problems are only logged.

function uploadedBytes(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files && typeof req.files === 'object') Object.values(req.files).forEach((list) => files.push(...list));
  return files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
}

export function startOperation(kind, { owner = null, inputBytes = 0 } = {}) {
  const startedAt = Date.now();
  const created = isDBConnected()
    ? Operation.create({ kind, owner, guest: !owner, inputBytes, createdAt: new Date(startedAt) }).catch((err) => {
      console.warn('Could not record operation:', err.message);
      return null;
    })
    : Promise.resolve(null);
  let ended = false;
  const end = (update) => {
    if (ended) return;
    ended = true;
    created.then((doc) => doc && Operation.updateOne(
      { _id: doc._id },
      { $set: { ...update, finishedAt: new Date(), durationMs: Date.now() - startedAt } },
    )).catch((err) => console.warn('Could not update operation:', err.message));
  };
  // `extra`: fields only known by the end, e.g. { kind: 'longmix' }.
  return {
    done: (extra = {}) => end({ ...extra, status: 'done' }),
    fail: (error, extra = {}) => end({
      ...extra,
      status: 'error',
      error: typeof error === 'string' ? error : toUserMessage(error, 'It failed.'),
      errorDetails: typeof error === 'string' ? null : String(error?.details || error?.message || '').slice(-2000) || null,
    }),
  };
}

export function trackOperation(kind) {
  return (req, res, next) => {
    const operation = startOperation(kind, { owner: req.user?._id || null, inputBytes: uploadedBytes(req) });
    req.operation = operation;

    // Remember the error message the route answers with.
    let answeredError = null;
    const json = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body.error === 'string') answeredError = body.error;
      return json(body);
    };

    res.on('finish', () => {
      if (res.statusCode === 202) return; // a background job - it reports its own end
      if (res.statusCode >= 400) operation.fail(answeredError || `It failed (HTTP ${res.statusCode}).`);
      else operation.done();
    });
    res.on('close', () => {
      if (!res.writableFinished) operation.fail('The connection closed before it finished.');
    });
    next();
  };
}

// After a restart, anything still marked running was cut off - on a small
// host (Render's free plan) a restart also empties the disk.
export async function markInterruptedOperations(startedBefore = new Date()) {
  try {
    const { modifiedCount } = await Operation.updateMany(
      { status: 'running', createdAt: { $lt: startedBefore } },
      { $set: { status: 'error', error: 'The server restarted while this was running.', finishedAt: new Date() } },
    );
    if (modifiedCount) console.warn(`Marked ${modifiedCount} interrupted operation(s) as failed.`);
  } catch (err) {
    console.warn('Could not mark interrupted operations:', err.message);
  }
}

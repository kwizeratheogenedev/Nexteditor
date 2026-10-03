import { isDBConnected } from '../db.js';
import Job from '../models/Job.js';

// Fire-and-forget - never let job bookkeeping break the actual processing
// pipeline (a Mongo hiccup shouldn't fail a montage/export that otherwise
// succeeded). Only called when the request is authenticated; anonymous
// requests keep working exactly as before (no Job record, no resume).
//
// Writes for the same job run one after another, in the order they were
// made. Callers don't wait for them, so without this a job that failed
// straight away could have its "error" write land before its first
// ("running", which carries the kind) - creating a record with no kind, which
// crashed the "while you were away" banner on every visit.
const pendingByJob = new Map(); // jobId -> promise of its latest write

function inOrder(jobId, write) {
  const previous = pendingByJob.get(jobId) || Promise.resolve();
  const next = previous.then(write, write);
  pendingByJob.set(jobId, next);
  next.finally(() => {
    if (pendingByJob.get(jobId) === next) pendingByJob.delete(jobId);
  });
  return next;
}

export function upsertJob(ownerId, { jobId, kind, status, progress, message, result, error }) {
  if (!ownerId || !jobId || !isDBConnected()) return Promise.resolve();
  return inOrder(jobId, async () => {
    try {
      const update = { updatedAt: new Date() };
      if (status !== undefined) update.status = status;
      if (progress !== undefined) update.progress = progress;
      if (message !== undefined) update.message = message;
      if (result !== undefined) update.result = result;
      if (error !== undefined) update.error = error;
      await Job.findOneAndUpdate(
        { owner: ownerId, jobId },
        { $set: update, $setOnInsert: { owner: ownerId, jobId, kind, createdAt: new Date() } },
        // Only a write that knows the kind may create the record.
        { upsert: Boolean(kind) },
      );
    } catch (err) {
      console.error('Failed to upsert job:', err.message);
    }
  });
}

// A job the user stopped themselves - nothing to show them later.
export function removeJob(ownerId, jobId) {
  if (!ownerId || !jobId || !isDBConnected()) return Promise.resolve();
  return inOrder(jobId, async () => {
    try {
      await Job.deleteOne({ owner: ownerId, jobId });
    } catch (err) {
      console.error('Failed to remove job:', err.message);
    }
  });
}

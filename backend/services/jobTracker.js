import { isDBConnected } from '../db.js';
import Job from '../models/Job.js';

// Fire-and-forget - never let job bookkeeping break the actual processing
// pipeline (a Mongo hiccup shouldn't fail a montage/export that otherwise
// succeeded). Only called when the request is authenticated; anonymous
// requests keep working exactly as before (no Job record, no resume).
export async function upsertJob(ownerId, { jobId, kind, status, progress, message, result, error }) {
  if (!ownerId || !jobId || !isDBConnected()) return;
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
      { upsert: true },
    );
  } catch (err) {
    console.error('Failed to upsert job:', err.message);
  }
}

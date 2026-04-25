import crypto from 'crypto';

export const jobStore = new Map();

export function registerJob(absolutePath) {
  const jobId = crypto.randomUUID();
  jobStore.set(jobId, { path: absolutePath, createdAt: Date.now() });
  return jobId;
}

export function resolveJob(jobId) {
  const entry = jobStore.get(jobId);
  return entry ? entry.path : null;
}

export function deleteJob(jobId) {
  jobStore.delete(jobId);
}

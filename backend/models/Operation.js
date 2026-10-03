import mongoose from 'mongoose';

const { Schema } = mongoose;

// One row per piece of work the server did (a montage, a merge, a link
// download...), for the admin dashboard - including guests, who have no
// account (owner: null). Separate from Job, which is the user's own "while
// you were away" list and is deleted when they dismiss it. See
// services/operations.js.

export const OPERATION_KINDS = [
  'montage', 'merge', 'shorts', 'short-edit', 'subtitles', 'captions',
  'editor-captions', 'caption-part', 'export', 'longmix', 'link-fetch', 'youtube-upload',
];

const RETENTION_DAYS = Number(process.env.OPERATIONS_RETENTION_DAYS) > 0 ? Number(process.env.OPERATIONS_RETENTION_DAYS) : 30;

const operationSchema = new Schema({
  kind: { type: String, enum: OPERATION_KINDS, required: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  // No account (kept separately: a deleted user's rows also lose `owner`).
  guest: { type: Boolean, default: false },
  status: { type: String, enum: ['running', 'done', 'error'], default: 'running' },
  inputBytes: { type: Number, default: 0 },
  durationMs: { type: Number, default: null },
  // What the user was told, and the technical detail behind it.
  error: { type: String, default: null },
  errorDetails: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: null },
});

// Rows delete themselves after RETENTION_DAYS (MongoDB's TTL index).
operationSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });
operationSchema.index({ kind: 1, createdAt: -1 });
operationSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.Operation || mongoose.model('Operation', operationSchema);

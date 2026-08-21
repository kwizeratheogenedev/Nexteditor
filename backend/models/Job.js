import mongoose from 'mongoose';

const { Schema } = mongoose;

const jobSchema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jobId: { type: String, required: true, index: true },
  kind: { type: String, enum: ['montage', 'export', 'captions', 'shorts', 'youtube-upload'], required: true },
  status: { type: String, enum: ['running', 'done', 'error'], default: 'running' },
  progress: { type: Number, default: 0 },
  message: { type: String, default: '' },
  result: { type: Schema.Types.Mixed, default: null },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

jobSchema.index({ owner: 1, status: 1 });

export default mongoose.models.Job || mongoose.model('Job', jobSchema);

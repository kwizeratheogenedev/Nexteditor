import mongoose from 'mongoose';

const { Schema } = mongoose;

// Server speed per hour: request count, errors and total response time
// (average = totalMs / requests). Kept ~13 months.
const serverHourSchema = new Schema({
  hour: { type: Date, required: true, unique: true },
  requests: { type: Number, default: 0 },
  errors4xx: { type: Number, default: 0 },
  errors5xx: { type: Number, default: 0 },
  totalMs: { type: Number, default: 0 },
  slowRequests: { type: Number, default: 0 },
  expireAt: { type: Date, default: () => new Date(Date.now() + 395 * 24 * 60 * 60 * 1000) },
});

serverHourSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.ServerHour || mongoose.model('ServerHour', serverHourSchema);

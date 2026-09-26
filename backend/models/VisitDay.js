import mongoose from 'mongoose';

const { Schema } = mongoose;

const THIRTEEN_MONTHS_S = 395 * 24 * 60 * 60;

// One row per visitor per day (in ANALYTICS_TIMEZONE). A visitor is a random
// id kept in the browser - no IP address and, for anonymous visitors, no
// name or email. Each "ping" is roughly one active minute with the tab open.
// Rows expire after ~13 months; totals derived from them are what the
// analytics screens show.
const visitDaySchema = new Schema({
  day: { type: String, required: true },
  visitorId: { type: String, required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  isNewVisitor: { type: Boolean, default: false },
  source: { type: String, default: 'direct' },
  referrerHost: { type: String, default: '' },
  device: { type: String, enum: ['desktop', 'mobile', 'tablet'], default: 'desktop' },
  pings: { type: Number, default: 0 },
  // Pings per workspace ('editor', 'montage', ...) and per hour of the day
  // ('0'..'23'). No defaults on purpose: they're only ever $inc'd, and a
  // default would be $setOnInsert'd on the same path and conflict.
  areas: { type: Map, of: Number },
  hours: { type: Map, of: Number },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  expireAt: { type: Date, default: () => new Date(Date.now() + THIRTEEN_MONTHS_S * 1000) },
});

visitDaySchema.index({ day: 1, visitorId: 1 }, { unique: true });
visitDaySchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.VisitDay || mongoose.model('VisitDay', visitDaySchema);

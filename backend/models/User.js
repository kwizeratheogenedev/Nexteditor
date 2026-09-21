import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, default: null },
  googleId: { type: String, default: null, index: true, sparse: true },
  name: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  authProviders: [{ type: String, enum: ['local', 'google'] }],

  youtube: {
    accessToken: { type: String, default: null },
    refreshToken: { type: String, default: null },
    expiryDate: { type: Number, default: null },
    scope: { type: String, default: null },
    channelTitle: { type: String, default: null },
    channelThumbnail: { type: String, default: null },
  },

  subscription: {
    plan: { type: String, enum: ['free', 'pro'], default: 'free' },
    status: { type: String, enum: ['none', 'active', 'trialing', 'past_due', 'canceled'], default: 'none' },
    momoPaymentRef: { type: String, default: null },
    momoLastAppliedRef: { type: String, default: null },
    cardCustomerId: { type: String, default: null },
    cardSubscriptionId: { type: String, default: null },
    currentPeriodEnd: { type: Date, default: null },
  },

  usage: {
    projectCount: { type: Number, default: 0 },
    exportsThisPeriod: { type: Number, default: 0 },
    exportsPeriodStart: { type: Date, default: Date.now },
    storageBytesUsed: { type: Number, default: 0 },
  },

  createdAt: { type: Date, default: Date.now },
});

// Never let a bug accidentally serialize the hash to a client.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.youtube;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.models.User || mongoose.model('User', userSchema);

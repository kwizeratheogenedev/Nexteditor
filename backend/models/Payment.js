import mongoose from 'mongoose';

const { Schema } = mongoose;

// One row per successful payment (MoMo, card, or a manual/cash payment an
// admin records), so revenue and a user's payment history can be shown.
// `userEmail` is a snapshot: if the account is later deleted, `user` is
// cleared and the email anonymised, but the payment stays for accounting.
const paymentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  userEmail: { type: String, default: '' },
  provider: { type: String, enum: ['momo', 'card', 'manual'], required: true },
  reference: { type: String, required: true },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: '' },
  status: { type: String, enum: ['successful', 'failed', 'refunded'], default: 'successful' },
  periodEnd: { type: Date, default: null },
  note: { type: String, default: '' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now, index: true },
});

// The same provider reference can never be recorded twice, however many
// times a status poll, redirect and webhook all confirm the same payment.
paymentSchema.index({ provider: 1, reference: 1 }, { unique: true });

export default mongoose.models.Payment || mongoose.model('Payment', paymentSchema);

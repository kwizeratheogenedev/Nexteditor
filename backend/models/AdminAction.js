import mongoose from 'mongoose';

const { Schema } = mongoose;

// Audit trail: every change an admin makes from the admin panel.
const adminActionSchema = new Schema({
  admin: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  adminEmail: { type: String, default: '' },
  action: { type: String, required: true },
  targetUser: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  targetEmail: { type: String, default: '' },
  details: { type: Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
});

export default mongoose.models.AdminAction || mongoose.model('AdminAction', adminActionSchema);

import mongoose from 'mongoose';

const { Schema } = mongoose;

const projectSchema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['editor', 'montage'], default: 'editor' },
  name: { type: String, default: 'Untitled project' },
  data: { type: Schema.Types.Mixed, required: true },
  thumbnailUrl: { type: String, default: '' },
  isDeleted: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.models.Project || mongoose.model('Project', projectSchema);

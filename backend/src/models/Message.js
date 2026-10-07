import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['text', 'image', 'video', 'audio'], default: 'text' },
  text: { type: String, default: '', maxlength: 5000 },
  mediaUrl: { type: String, default: '' },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

schema.index({ conversation: 1, createdAt: -1 });

export default mongoose.model('Message', schema);

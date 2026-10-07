import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  lastMessageAt: { type: Date, default: null }
}, { timestamps: true });

schema.index({ participants: 1 });
schema.index({ participants: 1, updatedAt: -1 });

export default mongoose.model('Conversation', schema);

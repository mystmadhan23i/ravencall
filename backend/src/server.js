import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import User from './models/User.js';
import FollowRequest from './models/FollowRequest.js';
import Conversation from './models/Conversation.js';
import Message from './models/Message.js';
import { auth } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const uploadDir = path.join(root, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const PORT = Number(process.env.PORT || 5000);
const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGODB_URI) throw new Error('MONGODB_URI is missing. Create backend/.env from .env.example.');
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_URL, methods: ['GET', 'POST', 'PATCH', 'DELETE'] } });

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadDir));

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const mediaTypes = new Set([...imageTypes, 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4']);
const diskStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, mediaTypes.has(file.mimetype))
});
const avatarUpload = multer({
  storage: diskStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, imageTypes.has(file.mimetype))
});

const id = value => String(value?._id ?? value);
const hasId = (list, value) => (list || []).some(x => id(x) === id(value));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safeUser = user => ({
  id: id(user), username: user.username, name: user.name, bio: user.bio || '', avatar: user.avatar || '',
  followers: user.followers?.length || 0, following: user.following?.length || 0,
  online: Boolean(user.online), lastSeen: user.lastSeen || null
});
const tokenFor = user => jwt.sign({ id: id(user) }, JWT_SECRET, { expiresIn: '7d' });
const passwordOk = p => typeof p === 'string' && p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
const usernameOk = u => /^[a-z0-9._-]{3,30}$/.test(u);

function isMutual(me, other) {
  return hasId(me.following, other) && hasId(me.followers, other);
}

async function getRelationship(me, other) {
  if (hasId(me.blocked, other)) return 'blocked';
  if (hasId(me.blockedBy, other)) return 'blocked_by';
  if (isMutual(me, other)) return 'mutual';
  if (hasId(me.following, other)) return 'following';
  const outgoing = await FollowRequest.findOne({ from: me._id, to: other._id, status: 'pending' }).lean();
  if (outgoing) return 'requested';
  const incoming = await FollowRequest.findOne({ from: other._id, to: me._id, status: 'pending' }).lean();
  if (incoming) return 'incoming';
  return 'none';
}

function publicConversation(c) {
  return {
    id: id(c),
    participants: c.participants.map(safeUser),
    lastMessage: c.lastMessage || null,
    lastMessageAt: c.lastMessageAt || c.updatedAt || null
  };
}

async function requireMutual(meId, otherId) {
  const [me, other] = await Promise.all([User.findById(meId), User.findById(otherId)]);
  if (!me || !other) return null;
  if (hasId(me.blocked, other) || hasId(me.blockedBy, other)) return null;
  return isMutual(me, other) ? { me, other } : null;
}

app.get('/api/health', (_, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const password = req.body.password;
    if (!email || !username || !name || !password) return res.status(400).json({ message: 'All fields are required' });
    if (!passwordOk(password)) return res.status(400).json({ message: 'Password must be 8+ chars with uppercase, lowercase, number and special character' });
    if (!usernameOk(username)) return res.status(400).json({ message: 'Username: 3-30 letters, numbers, dot, underscore or hyphen' });
    if (name.length > 60) return res.status(400).json({ message: 'Name is too long' });
    const exists = await User.findOne({ $or: [{ email }, { username }] }).lean();
    if (exists) return res.status(409).json({ message: 'Email or username already exists' });
    const user = await User.create({ email, username, name, password: await bcrypt.hash(password, 12), online: true, lastSeen: new Date() });
    res.status(201).json({ token: tokenFor(user), user: safeUser(user) });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ message: 'Email or username already exists' });
    res.status(500).json({ message: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: 'Invalid email or password' });
    user.online = true; user.lastSeen = new Date(); await user.save();
    res.json({ token: tokenFor(user), user: safeUser(user) });
  } catch {
    res.status(500).json({ message: 'Login failed' });
  }
});

app.post('/api/auth/logout', auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { online: false, lastSeen: new Date() });
  res.json({ ok: true });
});

app.get('/api/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: safeUser(user) });
});

app.get('/api/users/search', auth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const me = await User.findById(req.user.id).select('blocked blockedBy followers following');
    if (!me) return res.status(404).json({ message: 'User not found' });
    const excluded = [...new Set([...me.blocked.map(id), ...me.blockedBy.map(id)])].map(x => new mongoose.Types.ObjectId(x));
    const filter = { _id: { $ne: me._id, $nin: excluded } };
    if (q) {
      const regex = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ username: regex }, { name: regex }];
    }
    const users = await User.find(filter).select('username name bio avatar followers following online lastSeen').sort({ online: -1, name: 1 }).limit(50);
    const pending = await FollowRequest.find({ status: 'pending', $or: [{ from: me._id }, { to: me._id }] }).lean();
    const result = users.map(user => {
      const outgoing = pending.some(r => id(r.from) === id(me) && id(r.to) === id(user));
      const incoming = pending.some(r => id(r.from) === id(user) && id(r.to) === id(me));
      let relation = 'none';
      if (isMutual(me, user)) relation = 'mutual';
      else if (hasId(me.following, user)) relation = 'following';
      else if (outgoing) relation = 'requested';
      else if (incoming) relation = 'incoming';
      return { ...safeUser(user), relation };
    });
    res.json({ users: result });
  } catch {
    res.status(500).json({ message: 'Search failed' });
  }
});

app.get('/api/users/:username', auth, async (req, res) => {
  const user = await User.findOne({ username: String(req.params.username).toLowerCase() });
  if (!user) return res.status(404).json({ message: 'User not found' });
  const me = await User.findById(req.user.id).select('blocked blockedBy followers following');
  if (hasId(me.blocked, user) || hasId(me.blockedBy, user)) return res.status(404).json({ message: 'User not found' });
  res.json({ user: safeUser(user), relation: await getRelationship(me, user) });
});

app.post('/api/follows/request/:id', auth, async (req, res) => {
  try {
    const [me, target] = await Promise.all([User.findById(req.user.id), User.findById(req.params.id)]);
    if (!me || !target || id(me) === id(target)) return res.status(400).json({ message: 'Invalid user' });
    if (hasId(me.blocked, target) || hasId(me.blockedBy, target)) return res.status(403).json({ message: 'Cannot follow this user' });
    if (isMutual(me, target)) return res.status(400).json({ message: 'You already follow each other' });
    if (hasId(me.following, target) && hasId(target.following, me)) {
      await Promise.all([
        User.findByIdAndUpdate(me._id, { $addToSet: { followers: target._id } }),
        User.findByIdAndUpdate(target._id, { $addToSet: { followers: me._id } })
      ]);
      return res.json({ message: 'You now follow each other', relation: 'mutual' });
    }
    if (hasId(me.following, target)) return res.status(400).json({ message: 'Already following' });

    const reverse = await FollowRequest.findOne({ from: target._id, to: me._id, status: 'pending' });
    if (reverse) {
      reverse.status = 'accepted';
      await reverse.save();
      await Promise.all([
        User.findByIdAndUpdate(me._id, { $addToSet: { following: target._id, followers: target._id } }),
        User.findByIdAndUpdate(target._id, { $addToSet: { following: me._id, followers: me._id } })
      ]);
      return res.json({ message: 'You now follow each other', relation: 'mutual' });
    }

    const existing = await FollowRequest.findOne({ from: me._id, to: target._id });
    if (existing?.status === 'pending') return res.json({ message: 'Follow request already sent', relation: 'requested' });
    if (existing) { existing.status = 'pending'; await existing.save(); }
    else await FollowRequest.create({ from: me._id, to: target._id, status: 'pending' });
    res.json({ message: 'Follow request sent', relation: 'requested' });
  } catch (e) {
    if (e?.code === 11000) return res.json({ message: 'Follow request already sent', relation: 'requested' });
    res.status(500).json({ message: 'Follow request failed' });
  }
});

app.get('/api/follows/requests', auth, async (req, res) => {
  const rows = await FollowRequest.find({ to: req.user.id, status: 'pending' }).sort({ createdAt: -1 }).populate('from', 'username name bio avatar followers following online lastSeen');
  res.json({ requests: rows.map(r => ({ id: id(r), user: safeUser(r.from), createdAt: r.createdAt })) });
});

app.post('/api/follows/:id/accept', auth, async (req, res) => {
  const request = await FollowRequest.findOne({ _id: req.params.id, to: req.user.id, status: 'pending' });
  if (!request) return res.status(404).json({ message: 'Request not found' });
  const [me, other] = await Promise.all([User.findById(req.user.id), User.findById(request.from)]);
  if (!me || !other) return res.status(404).json({ message: 'User not found' });
  if (hasId(me.blocked, other) || hasId(me.blockedBy, other)) { request.status = 'rejected'; await request.save(); return res.status(403).json({ message: 'Cannot accept this request' }); }
  request.status = 'accepted';
  await request.save();
  await Promise.all([
    User.findByIdAndUpdate(me._id, { $addToSet: { followers: other._id, following: other._id } }),
    User.findByIdAndUpdate(other._id, { $addToSet: { following: me._id, followers: me._id } })
  ]);
  res.json({ message: 'Request accepted', relation: 'mutual' });
});

app.post('/api/follows/:id/reject', auth, async (req, res) => {
  const request = await FollowRequest.findOneAndUpdate({ _id: req.params.id, to: req.user.id, status: 'pending' }, { status: 'rejected' }, { new: true });
  if (!request) return res.status(404).json({ message: 'Request not found' });
  res.json({ message: 'Request rejected' });
});

app.delete('/api/follows/:id', auth, async (req, res) => {
  const other = await User.findById(req.params.id);
  const me = await User.findById(req.user.id);
  if (!other || !me) return res.status(404).json({ message: 'User not found' });
  await Promise.all([
    User.findByIdAndUpdate(me._id, { $pull: { following: other._id, followers: other._id } }),
    User.findByIdAndUpdate(other._id, { $pull: { following: me._id, followers: me._id } }),
    FollowRequest.deleteMany({ $or: [{ from: me._id, to: other._id }, { from: other._id, to: me._id }] })
  ]);
  res.json({ message: 'Follow relationship removed', relation: 'none' });
});

app.post('/api/users/:id/block', auth, async (req, res) => {
  if (id(req.params.id) === id(req.user.id)) return res.status(400).json({ message: 'Cannot block yourself' });
  const [me, other] = await Promise.all([User.findById(req.user.id), User.findById(req.params.id)]);
  if (!other) return res.status(404).json({ message: 'User not found' });
  await Promise.all([
    User.findByIdAndUpdate(me._id, { $addToSet: { blocked: other._id }, $pull: { following: other._id, followers: other._id } }),
    User.findByIdAndUpdate(other._id, { $addToSet: { blockedBy: me._id }, $pull: { following: me._id, followers: me._id } }),
    FollowRequest.deleteMany({ $or: [{ from: me._id, to: other._id }, { from: other._id, to: me._id }] })
  ]);
  res.json({ message: 'User blocked' });
});

app.post('/api/profile', auth, avatarUpload.single('avatar'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 60) return res.status(400).json({ message: 'Name must be 1-60 characters' });
      user.name = name;
    }
    if (req.body.username !== undefined) {
      const username = String(req.body.username).trim().toLowerCase();
      if (!usernameOk(username)) return res.status(400).json({ message: 'Invalid username' });
      const exists = await User.findOne({ username, _id: { $ne: user._id } }).lean();
      if (exists) return res.status(409).json({ message: 'Username already taken' });
      user.username = username;
    }
    if (req.body.bio !== undefined) user.bio = String(req.body.bio).slice(0, 160);
    if (req.file) user.avatar = `/uploads/${req.file.filename}`;
    await user.save();
    res.json({ user: safeUser(user) });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ message: 'Username already taken' });
    res.status(500).json({ message: 'Profile update failed' });
  }
});

app.get('/api/conversations', auth, async (req, res) => {
  const [me, cs] = await Promise.all([
    User.findById(req.user.id).select('followers following blocked blockedBy'),
    Conversation.find({ participants: req.user.id }).sort({ lastMessageAt: -1, updatedAt: -1 }).populate('participants', 'username name bio avatar online lastSeen followers following').populate('lastMessage')
  ]);
  const visible = cs.filter(conversation => {
    const other = conversation.participants.find(p => id(p) !== id(req.user.id));
    return other && me && isMutual(me, other) && !hasId(me.blocked, other) && !hasId(me.blockedBy, other);
  });
  res.json({ conversations: visible.map(publicConversation) });
});

app.post('/api/conversations/:userId', auth, async (req, res) => {
  const relationship = await requireMutual(req.user.id, req.params.userId);
  if (!relationship) return res.status(403).json({ message: 'You can message only after you both follow each other' });
  const { me, other } = relationship;
  let conversation = await Conversation.findOne({ participants: { $all: [me._id, other._id], $size: 2 } });
  if (!conversation) conversation = await Conversation.create({ participants: [me._id, other._id] });
  conversation = await Conversation.findById(conversation._id).populate('participants', 'username name bio avatar online lastSeen followers following').populate('lastMessage');
  res.json({ conversation: publicConversation(conversation) });
});

app.get('/api/conversations/:id/messages', auth, async (req, res) => {
  const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user.id });
  if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
  const otherId = conversation.participants.find(p => String(p) !== String(req.user.id));
  if (!otherId || !(await requireMutual(req.user.id, otherId))) return res.status(403).json({ message: 'This chat is no longer available' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const before = req.query.before ? new Date(req.query.before) : null;
  const filter = { conversation: conversation._id };
  if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
  const messages = await Message.find(filter).populate('sender', 'username name avatar').sort({ createdAt: -1 }).limit(limit);
  await Message.updateMany({ conversation: conversation._id, sender: { $ne: req.user.id }, readBy: { $ne: req.user.id } }, { $addToSet: { readBy: req.user.id } });
  res.json({ messages: messages.reverse(), hasMore: messages.length === limit });
});

app.post('/api/conversations/:id/read', auth, async (req, res) => {
  const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user.id });
  if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
  const otherId = conversation.participants.find(p => String(p) !== String(req.user.id));
  if (!otherId || !(await requireMutual(req.user.id, otherId))) return res.status(403).json({ message: 'This chat is no longer available' });
  await Message.updateMany({ conversation: conversation._id, sender: { $ne: req.user.id }, readBy: { $ne: req.user.id } }, { $addToSet: { readBy: req.user.id } });
  res.json({ ok: true });
});

app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Unsupported file or no file selected' });
  const type = req.file.mimetype.startsWith('image/') ? 'image' : req.file.mimetype.startsWith('video/') ? 'video' : 'audio';
  res.json({ url: `/uploads/${req.file.filename}`, type });
});

const socketsByUser = new Map();
function addSocket(userId, socketId) {
  const set = socketsByUser.get(userId) || new Set(); set.add(socketId); socketsByUser.set(userId, set);
}
function removeSocket(userId, socketId) {
  const set = socketsByUser.get(userId); if (!set) return false; set.delete(socketId); if (!set.size) socketsByUser.delete(userId); return !set.size;
}
function userRoom(userId) { return `user:${userId}`; }

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { next(new Error('Unauthorized')); }
});

io.on('connection', async socket => {
  const userId = String(socket.user.id);
  addSocket(userId, socket.id);
  socket.join(userRoom(userId));
  await User.findByIdAndUpdate(userId, { online: true, lastSeen: new Date() });
  io.emit('presence', { userId, online: true, lastSeen: new Date() });

  socket.on('join', async conversationId => {
    const allowed = await Conversation.exists({ _id: conversationId, participants: userId });
    if (allowed) socket.join(`conversation:${conversationId}`);
  });

  socket.on('send_message', async (data, ack) => {
    try {
      const conversation = await Conversation.findOne({ _id: data?.conversationId, participants: userId });
      if (!conversation) throw new Error('Conversation not found');
      const otherId = conversation.participants.find(p => String(p) !== userId);
      const relationship = await requireMutual(userId, otherId);
      if (!relationship) throw new Error('Messaging is available only between mutual followers');
      const type = ['text', 'image', 'video', 'audio'].includes(data?.type) ? data.type : 'text';
      const text = String(data?.text || '').slice(0, 5000);
      if (type === 'text' && !text.trim()) throw new Error('Message cannot be empty');
      if (type !== 'text' && !String(data?.mediaUrl || '').startsWith('/uploads/')) throw new Error('Invalid media');
      const message = await Message.create({ conversation: conversation._id, sender: userId, type, text, mediaUrl: type === 'text' ? '' : String(data.mediaUrl), readBy: [userId] });
      await Conversation.findByIdAndUpdate(conversation._id, { lastMessage: message._id, lastMessageAt: message.createdAt, updatedAt: message.createdAt });
      const full = await Message.findById(message._id).populate('sender', 'username name avatar');
      io.to(`conversation:${conversation._id}`).emit('message', full);
      io.to(userRoom(otherId)).emit('message', full);
      if (ack) ack({ ok: true, message: full });
    } catch (e) {
      if (ack) ack({ ok: false, message: e.message || 'Could not send message' });
      else socket.emit('error_message', { message: e.message || 'Could not send message' });
    }
  });

  socket.on('typing', async data => {
    const allowed = await Conversation.exists({ _id: data?.conversationId, participants: userId });
    if (allowed) socket.to(`conversation:${data.conversationId}`).emit('typing', { conversationId: String(data.conversationId), userId, typing: Boolean(data.typing) });
  });

  socket.on('disconnect', async () => {
    const becameOffline = removeSocket(userId, socket.id);
    if (becameOffline) {
      const lastSeen = new Date();
      await User.findByIdAndUpdate(userId, { online: false, lastSeen });
      io.emit('presence', { userId, online: false, lastSeen });
    }
  });
});

async function start() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log(`MongoDB Atlas connected (${mongoose.connection.name})`);
    server.listen(PORT, () => console.log(`Raven backend running on http://localhost:${PORT}`));
  } catch (error) {
    console.error(`MongoDB Atlas connection failed: ${error.message}`);
    process.exit(1);
  }
}

start();

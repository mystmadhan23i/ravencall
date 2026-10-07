import fs from 'fs';
import path from 'path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const backend = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'frontend/src/main.jsx'), 'utf8');
const user = fs.readFileSync(path.join(root, 'backend/src/models/User.js'), 'utf8');
const follow = fs.readFileSync(path.join(root, 'backend/src/models/FollowRequest.js'), 'utf8');

const checks = [
  ['MongoDB startup gate', backend.includes("await mongoose.connect(MONGODB_URI")],
  ['Atlas connection log', backend.includes('MongoDB Atlas connected')],
  ['Health database state', backend.includes("database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'")],
  ['User discovery without mandatory query', backend.includes("const filter = { _id: { $ne: me._id, $nin: excluded } }")],
  ['Name search', backend.includes("{ name: regex }")],
  ['Username search', backend.includes("{ username: regex }")],
  ['Follow request', backend.includes("app.post('/api/follows/request/:id'")],
  ['Accept request', backend.includes("app.post('/api/follows/:id/accept'")],
  ['Reject request', backend.includes("app.post('/api/follows/:id/reject'")],
  ['Unfollow', backend.includes("app.delete('/api/follows/:id'")],
  ['Mutual-only conversation creation', backend.includes('You can message only after you both follow each other')],
  ['Mutual-only message history', backend.includes('This chat is no longer available')],
  ['Socket authentication', backend.includes("socket.handshake.auth?.token")],
  ['Socket message authorization', backend.includes("const relationship = await requireMutual(userId, otherId)")],
  ['Upload MIME allowlist', backend.includes('mediaTypes = new Set')],
  ['Duplicate username schema index absent', !/userSchema\.index\(\{\s*username/.test(user)],
  ['Unique follow-request index', follow.includes("schema.index({ from: 1, to: 1 }, { unique: true })")],
  ['Frontend mutual Message action', frontend.includes("user.relation === 'mutual'")],
  ['Frontend search loads users', frontend.includes("load(query.trim())")],
  ['Frontend follow action', frontend.includes("/api/follows/request/${user.id}")],
  ['Frontend accept/reject', frontend.includes("/api/follows/${id}/${kind}")],
  ['Frontend Socket.IO chat', frontend.includes("io(API, { auth: { token: getToken() } })")],
  ['Frontend media upload', frontend.includes("api('/api/upload'")]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`\n${checks.length} static checks passed.`);

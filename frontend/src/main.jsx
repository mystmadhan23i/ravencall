import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import EmojiPicker from 'emoji-picker-react';
import './styles.css';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const TOKEN_KEY = 'raven_token';
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = token => localStorage.setItem(TOKEN_KEY, token);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

function Avatar({ user, size = 52 }) {
  const src = user?.avatar ? `${API}${user.avatar}` : '';
  return src
    ? <img className="avatar" src={src} alt="" style={{ width: size, height: size }} />
    : <div className="avatar placeholder" style={{ width: size, height: size }}>{(user?.name || user?.username || '?')[0].toUpperCase()}</div>;
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', username: '', name: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const submit = async e => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const data = await api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setToken(data.token); onLogin(data.user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <div className="auth"><div className="brand">RAVEN</div><p className="muted">Private messages. Real connections.</p><form onSubmit={submit} className="card authcard">
    {mode === 'register' && <><input name="name" placeholder="Full name" value={form.name} onChange={update} required /><input name="username" placeholder="Username" value={form.username} onChange={update} required /></>}
    <input name="email" type="email" placeholder="Email" value={form.email} onChange={update} required />
    <input name="password" type="password" placeholder="Password" value={form.password} onChange={update} required />
    <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
    {error && <div className="error">{error}</div>}
    <button type="button" className="linkbtn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Log in'}</button>
  </form>{mode === 'register' && <small className="muted">Password: 8+ chars, uppercase, lowercase, number and special character.</small>}</div>;
}

function RelationButton({ user, onAction, busy }) {
  if (user.relation === 'mutual') return <button className="small primary" onClick={() => onAction('message')} disabled={busy}>Message</button>;
  if (user.relation === 'following') return <button className="small ghost" onClick={() => onAction('unfollow')} disabled={busy}>Following</button>;
  if (user.relation === 'requested') return <button className="small ghost" disabled>Requested</button>;
  if (user.relation === 'incoming') return <button className="small ghost" onClick={() => onAction('profile')} disabled={busy}>Review request</button>;
  return <button className="small primary" onClick={() => onAction('follow')} disabled={busy}>Follow</button>;
}

function Search({ onOpenChat }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const load = async value => {
    setLoading(true); setError('');
    try { const data = await api(`/api/users/search${value ? `?q=${encodeURIComponent(value)}` : ''}`); setUsers(data.users || []); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { const t = setTimeout(() => load(query.trim()), 250); return () => clearTimeout(t); }, [query]);
  const action = async (user, type) => {
    setBusyId(user.id);
    try {
      if (type === 'message') { await onOpenChat(user); return; }
      if (type === 'follow') await api(`/api/follows/request/${user.id}`, { method: 'POST' });
      if (type === 'unfollow') await api(`/api/follows/${user.id}`, { method: 'DELETE' });
      await load(query.trim());
    } catch (e) { alert(e.message); } finally { setBusyId(''); }
  };
  return <section className="page"><div className="topbar"><div><h1>Find people</h1><p className="muted">Search by name or username.</p></div></div>
    <div className="searchbox">🔍<input autoFocus placeholder="Search people…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button onClick={() => setQuery('')}>×</button>}</div>
    {error && <div className="error">{error}</div>}{loading ? <div className="muted center">Loading people…</div> : !users.length ? <div className="empty"><div className="big">🐦</div><h2>No people found</h2><p className="muted">Try another name or username.</p></div> : <div className="results">{users.map(user => <div className="userrow card" key={user.id}><Avatar user={user} size={58}/><div className="grow"><b>{user.name}</b><span className="handle">@{user.username}</span><span className="bio">{user.bio || 'No bio yet'}</span></div><RelationButton user={user} onAction={type => action(user, type)} busy={busyId === user.id}/></div>)}</div>}
  </section>;
}

function Messages({ currentUser, onSelect }) {
  const [conversations, setConversations] = useState([]); const [error, setError] = useState('');
  const load = () => api('/api/conversations').then(d => setConversations(d.conversations || [])).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  return <section className="page"><div className="topbar"><h1>Messages</h1></div>{error && <div className="error">{error}</div>}{!conversations.length ? <div className="empty"><div className="big">💬</div><h2>Your messages</h2><p className="muted">When you both follow each other, your chat appears here.</p></div> : <div>{conversations.map(c => { const other = c.participants.find(p => String(p.id) !== String(currentUser.id)) || c.participants[0]; return <button className="chatrow" key={c.id} onClick={() => onSelect(c, other)}><Avatar user={other}/><div><b>{other.name}</b><span>@{other.username}</span><small>{c.lastMessage?.text || (c.lastMessage ? `${c.lastMessage.type} message` : 'Start a conversation')}</small></div>{other.online && <i className="online"/>}</button>; })}</div>}</section>;
}

function Chat({ conversation, user, onBack }) {
  const [messages, setMessages] = useState([]); const [text, setText] = useState(''); const [emoji, setEmoji] = useState(false); const [uploading, setUploading] = useState(false); const [typing, setTyping] = useState(false); const bottom = useRef();
  const socket = useMemo(() => io(API, { auth: { token: getToken() } }), []);
  const myId = useMemo(() => { try { return JSON.parse(atob(getToken().split('.')[1])).id; } catch { return ''; } }, []);
  useEffect(() => {
    let alive = true;
    api(`/api/conversations/${conversation.id}/messages`).then(d => { if (alive) setMessages(d.messages || []); }).catch(e => alert(e.message));
    socket.emit('join', conversation.id);
    socket.on('message', message => setMessages(old => old.some(m => m._id === message._id) ? old : [...old, message]));
    socket.on('typing', data => { if (String(data.conversationId) === String(conversation.id) && String(data.userId) !== String(myId)) { setTyping(data.typing); setTimeout(() => setTyping(false), 1800); } });
    socket.on('error_message', data => alert(data.message));
    api(`/api/conversations/${conversation.id}/read`, { method: 'POST' }).catch(() => {});
    return () => { alive = false; socket.disconnect(); };
  }, [conversation.id, myId, socket]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  const send = (type = 'text', mediaUrl = '') => {
    if (type === 'text' && !text.trim()) return;
    socket.emit('send_message', { conversationId: conversation.id, type, text: text.trim(), mediaUrl }, result => { if (!result?.ok) alert(result?.message || 'Could not send message'); });
    setText(''); setEmoji(false); socket.emit('typing', { conversationId: conversation.id, typing: false });
  };
  const handleText = e => { setText(e.target.value); socket.emit('typing', { conversationId: conversation.id, typing: Boolean(e.target.value.trim()) }); };
  const file = async e => { const f = e.target.files?.[0]; if (!f) return; setUploading(true); try { const fd = new FormData(); fd.append('file', f); const d = await api('/api/upload', { method: 'POST', body: fd }); send(d.type, d.url); } catch (err) { alert(err.message); } finally { setUploading(false); e.target.value = ''; } };
  return <section className="chat"><header><button className="iconbtn" onClick={onBack}>‹</button><Avatar user={user} size={42}/><div><b>{user.name}</b><span>{typing ? 'typing…' : user.online ? 'Active now' : `@${user.username}`}</span></div></header><main>{messages.map(m => { const mine = String(m.sender?._id || m.sender) === String(myId); return <div className={`bubble ${mine ? 'mine' : 'theirs'}`} key={m._id}>{m.type === 'image' && <img src={`${API}${m.mediaUrl}`} alt=""/>}{m.type === 'video' && <video src={`${API}${m.mediaUrl}`} controls/>}{m.type === 'audio' && <audio src={`${API}${m.mediaUrl}`} controls/>}{m.text && <span>{m.text}</span>}<small>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>; })}<div ref={bottom}/></main><div className="composer"><label className="iconbtn">＋<input hidden type="file" accept="image/*,video/*,audio/*" onChange={file}/></label><div className="inputwrap"><input value={text} onChange={handleText} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Message…"/><button onClick={() => setEmoji(v => !v)}>☺</button></div><button className="send" onClick={() => send()} disabled={uploading}>{uploading ? '…' : '➤'}</button>{emoji && <div className="emoji"><EmojiPicker theme="dark" onEmojiClick={x => setText(t => t + x.emoji)}/></div>}</div></section>;
}

function Profile({ user, onUser, onOpenChat }) {
  const [name, setName] = useState(user.name); const [username, setUsername] = useState(user.username); const [bio, setBio] = useState(user.bio || ''); const [avatar, setAvatar] = useState(null); const [requests, setRequests] = useState([]); const [message, setMessage] = useState('');
  const loadRequests = () => api('/api/follows/requests').then(d => setRequests(d.requests || [])).catch(e => setMessage(e.message));
  useEffect(() => { loadRequests(); }, []);
  useEffect(() => { setName(user.name); setUsername(user.username); setBio(user.bio || ''); }, [user]);
  const save = async () => { try { const fd = new FormData(); fd.append('name', name); fd.append('username', username); fd.append('bio', bio); if (avatar) fd.append('avatar', avatar); const d = await api('/api/profile', { method: 'POST', body: fd }); onUser(d.user); setMessage('Profile saved ✓'); } catch (e) { setMessage(e.message); } };
  const respond = async (id, kind) => { try { await api(`/api/follows/${id}/${kind}`, { method: 'POST' }); await loadRequests(); if (kind === 'accept') { const me = await api('/api/me'); onUser(me.user); } setMessage(kind === 'accept' ? 'Request accepted ✓' : 'Request rejected'); } catch (e) { setMessage(e.message); } };
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} clearToken(); location.reload(); };
  return <section className="page"><div className="topbar"><h1>Profile</h1><button className="ghost" onClick={logout}>Log out</button></div><div className="profilehero"><Avatar user={user} size={92}/><div><h2>{user.name}</h2><span>@{user.username}</span><p>{user.bio || 'No bio yet'}</p></div></div><div className="stats"><div><b>{user.followers}</b><span>followers</span></div><div><b>{user.following}</b><span>following</span></div></div><div className="card form"><h3>Edit profile</h3><input value={name} onChange={e => setName(e.target.value)} placeholder="Name"/><input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username"/><textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="Bio"/><label className="filelabel">Change profile photo<input type="file" accept="image/*" onChange={e => setAvatar(e.target.files?.[0] || null)}/></label><button className="primary" onClick={save}>Save changes</button>{message && <div className="muted">{message}</div>}</div><div className="card requests"><h3>Follow requests {requests.length ? `(${requests.length})` : ''}</h3>{!requests.length ? <span className="muted">No pending requests</span> : requests.map(r => <div className="request" key={r.id}><Avatar user={r.user} size={48}/><div className="grow"><b>{r.user.name}</b><span>@{r.user.username}</span></div><button className="small primary" onClick={() => respond(r.id, 'accept')}>Accept</button><button className="small ghost" onClick={() => respond(r.id, 'reject')}>Reject</button></div>)}</div></section>;
}

function App() {
  const [user, setUser] = useState(null); const [page, setPage] = useState('search'); const [chat, setChat] = useState(null); const [booting, setBooting] = useState(true);
  useEffect(() => { if (!getToken()) { setBooting(false); return; } api('/api/me').then(d => setUser(d.user)).catch(() => clearToken()).finally(() => setBooting(false)); }, []);
  const openChat = async other => { try { const data = await api(`/api/conversations/${other.id}`, { method: 'POST' }); setChat({ c: data.conversation, u: other }); } catch (e) { alert(e.message); } };
  if (booting) return <div className="auth"><div className="brand">RAVEN</div><p className="muted">Loading…</p></div>;
  if (!user) return <Auth onLogin={setUser}/>;
  if (chat) return <div className="app"><Chat conversation={chat.c} user={chat.u} onBack={() => { setChat(null); setPage('messages'); }}/></div>;
  return <div className="app"><div className="content">{page === 'search' ? <Search onOpenChat={openChat}/> : page === 'messages' ? <Messages currentUser={user} onSelect={(c, u) => setChat({ c, u })}/> : <Profile user={user} onUser={setUser} onOpenChat={openChat}/>}</div><nav><button className={page === 'search' ? 'active' : ''} onClick={() => setPage('search')}>⌕<span>Search</span></button><button className={page === 'messages' ? 'active' : ''} onClick={() => setPage('messages')}>✉<span>Messages</span></button><button className={page === 'profile' ? 'active' : ''} onClick={() => setPage('profile')}>◯<span>Profile</span></button></nav></div>;
}

createRoot(document.getElementById('root')).render(<App/>);

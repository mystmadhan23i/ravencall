# Raven Messenger

A private, mutual-follow-only real-time messenger built with React/Vite, Node/Express, MongoDB Atlas and Socket.IO.

## Working feature set

- Register / login / logout
- Strong password validation
- User discovery with no search term
- Search by name or username, case-insensitive
- Follow requests
- Incoming request list
- Accept request -> both users become mutual followers
- Reject request
- Follow-back automatically completes a mutual relationship
- Unfollow
- Block user and remove follow relationship
- Mutual-follow-only conversation creation
- Mutual-follow-only chat history and sending
- Real-time text messages with Socket.IO
- Typing indicator
- Read-state update
- Image / video / audio messages
- Emoji picker
- Online / last-seen presence
- Profile name / username / bio / avatar editing
- Conversation list
- Pagination-ready message endpoint
- MongoDB Atlas connection is required before the server starts
- `/api/health` reports database connection state

## 1. MongoDB Atlas

Create/use a MongoDB Atlas cluster and database. Make sure your current IP is allowed in Atlas Network Access.

Copy `backend/.env.example` to `backend/.env` and set:

```env
PORT=5000
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/raven?retryWrites=true&w=majority
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters
CLIENT_URL=http://localhost:5173
```

Do **not** put the MongoDB URI in the frontend or commit `.env`.

## 2. Start backend

```bash
cd backend
npm install
npm start
```

A successful startup must print both:

```text
MongoDB Atlas connected (raven)
Raven backend running on http://localhost:5000
```

If Atlas cannot be reached, the server exits instead of pretending the app is ready.

Check:

```bash
curl http://localhost:5000/api/health
```

Expected:

```json
{"ok":true,"database":"connected"}
```

## 3. Start frontend

Copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_API_URL=http://localhost:5000
```

Then:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## 4. Complete acceptance test

Use two separate browser profiles/incognito windows.

### Account A
1. Register `A`.
2. Open Search.
3. Account B should be discoverable even with an empty search field.
4. Search B by name or username.
5. Click **Follow**.
6. It must change to **Requested**.

### Account B
7. Open Profile.
8. The incoming request must appear.
9. Click **Accept**.
10. The request disappears.
11. Followers/following counts update.

### Account A
12. Refresh/search again.
13. B must now show **Message**.
14. Open Message.
15. Send text.

### Account B
16. The message must arrive in real time.
17. Send a reply.
18. A must receive it without refreshing.

### Rejection path
19. Send another follow request from one account.
20. Reject it from the other account.
21. The requester must no longer see the request as pending.
22. They may send a new request later.

### Unfollow path
23. Unfollow the user.
24. Message access must disappear.
25. Existing chat history must no longer be accessible while they are not mutual.

### Block path
26. Block the user.
27. The blocked user must disappear from discovery and follow/message access.

## Static verification

From the project root:

```bash
node scripts/static-smoke.mjs
```

This verifies the important source-level contracts.

## Important implementation rule

The application does not consider `following` alone sufficient for messaging. A user can open a chat only when both users are present in each other's `following` and `followers` relationships. That rule is enforced by the REST API and Socket.IO server, not just the UI.

## Development uploads

Media is stored under `backend/uploads` for local development. For production, move media storage to S3/object storage and put a CDN in front of it.

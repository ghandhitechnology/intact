import http from 'http';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { Server, Socket } from 'socket.io';

type SessionUser = {
  id: string;
  nickname: string;
  studentId: string;
};

type ClientMessage = {
  clientId: string;
  roomId: string;
  content: string;
  type?: 'TEXT' | 'IMAGE' | 'FILE';
  replyToId?: string;
};

type Ack = (payload: { ok: boolean; message?: unknown; error?: string }) => void;

const port = Number(process.env.PORT || 3001);
const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
const internalApiUrl = process.env.INTERNAL_API_URL || webOrigin;
const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: webOrigin, credentials: true }));
app.get('/health', (_request, response) => response.json({ ok: true, service: 'igwak-realtime' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: webOrigin, credentials: true },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 2 * 1024 * 1024,
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

function internalRequestAllowed(request: express.Request) {
  const expected = process.env.INTERNAL_API_SECRET || '';
  const supplied = request.headers['x-igwak-internal'];
  if (!expected || typeof supplied !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

app.use('/internal', express.json({ limit: '128kb' }));
app.post('/internal/message', (request, response) => {
  if (!internalRequestAllowed(request)) {
    response.status(403).json({ ok: false });
    return;
  }
  const roomId = typeof request.body?.roomId === 'string' ? request.body.roomId : '';
  const message = request.body?.message;
  if (!roomId || !message || typeof message.id !== 'string') {
    response.status(400).json({ ok: false });
    return;
  }
  io.to(`room:${roomId}`).emit('chat:message', message);
  response.json({ ok: true });
});
app.post('/internal/room-created', (request, response) => {
  if (!internalRequestAllowed(request)) {
    response.status(403).json({ ok: false });
    return;
  }
  const roomId = typeof request.body?.roomId === 'string' ? request.body.roomId : '';
  const memberIds = Array.isArray(request.body?.memberIds)
    ? request.body.memberIds.filter((id: unknown): id is string => typeof id === 'string').slice(0, 10)
    : [];
  if (!roomId || !memberIds.length) {
    response.status(400).json({ ok: false });
    return;
  }
  for (const memberId of memberIds) {
    io.to(`user:${memberId}`).emit('room:created', { roomId });
  }
  response.json({ ok: true });
});

const attempts = new Map<string, number[]>();
const userConnectionCounts = new Map<string, number>();

function allowEvent(socketId: string, limit = 25, windowMs = 10_000) {
  const now = Date.now();
  const recent = (attempts.get(socketId) || []).filter((value) => now - value < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  attempts.set(socketId, recent);
  return true;
}

async function resolveSession(socket: Socket): Promise<SessionUser | null> {
  const cookie = socket.handshake.headers.cookie || '';
  if (!cookie) return null;

  try {
    const response = await fetch(`${internalApiUrl}/api/auth/session`, {
      headers: {
        cookie,
        'x-igwak-internal': process.env.INTERNAL_API_SECRET || '',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      user?: SessionUser;
      data?: { user?: SessionUser };
    };
    return body.user || body.data?.user || null;
  } catch {
    return null;
  }
}

async function canAccessRoom(socket: Socket, roomId: string) {
  try {
    const response = await fetch(`${internalApiUrl}/api/messages/rooms/${encodeURIComponent(roomId)}/authorize`, {
      headers: { cookie: socket.handshake.headers.cookie || '' },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

io.use(async (socket, next) => {
  const user = await resolveSession(socket);
  if (!user) {
    next(new Error('AUTH_REQUIRED'));
    return;
  }
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user as SessionUser;
  userConnectionCounts.set(user.id, (userConnectionCounts.get(user.id) || 0) + 1);
  socket.join(`user:${user.id}`);

  const accessTimer = setInterval(async () => {
    const refreshed = await resolveSession(socket);
    if (!refreshed || refreshed.id !== user.id) {
      socket.disconnect(true);
      return;
    }
    const roomIds = Array.from(socket.rooms)
      .filter((room) => room.startsWith('room:'))
      .map((room) => room.slice(5));
    await Promise.all(roomIds.map(async (roomId) => {
      if (!(await canAccessRoom(socket, roomId))) socket.leave(`room:${roomId}`);
    }));
  }, 30_000);
  accessTimer.unref();

  socket.on('room:join', async (roomId: string, ack?: Ack) => {
    if (!allowEvent(socket.id, 20) || typeof roomId !== 'string' || roomId.length > 80) {
      ack?.({ ok: false, error: 'INVALID_ROOM' });
      return;
    }

    try {
      if (!(await canAccessRoom(socket, roomId))) throw new Error('FORBIDDEN');
      socket.join(`room:${roomId}`);
      socket.to(`room:${roomId}`).emit('presence:update', {
        roomId,
        userId: user.id,
        status: 'online',
      });
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, error: 'FORBIDDEN' });
    }
  });

  socket.on('chat:message', async (input: ClientMessage, ack?: Ack) => {
    if (!allowEvent(socket.id, 12) || !input || typeof input.content !== 'string') {
      ack?.({ ok: false, error: 'RATE_LIMITED' });
      return;
    }
    const content = input.content.trim();
    if (!input.roomId || !input.clientId || !content || content.length > 4_000) {
      ack?.({ ok: false, error: 'INVALID_MESSAGE' });
      return;
    }
    if (!socket.rooms.has(`room:${input.roomId}`)) {
      ack?.({ ok: false, error: 'ROOM_NOT_JOINED' });
      return;
    }

    try {
      const response = await fetch(`${internalApiUrl}/api/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: socket.handshake.headers.cookie || '',
          'idempotency-key': input.clientId,
          'x-igwak-realtime-origin': process.env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({
          roomId: input.roomId,
          content,
          type: input.type || 'TEXT',
          replyToId: input.replyToId,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error('PERSIST_FAILED');
      const message = await response.json();
      io.to(`room:${input.roomId}`).emit('chat:message', message);
      ack?.({ ok: true, message });
    } catch {
      ack?.({ ok: false, error: 'DELIVERY_FAILED' });
    }
  });

  socket.on('chat:typing', (payload: { roomId?: string; active?: boolean }) => {
    if (!allowEvent(socket.id, 30) || !payload?.roomId || !socket.rooms.has(`room:${payload.roomId}`)) return;
    socket.to(`room:${payload.roomId}`).emit('chat:typing', {
      roomId: payload.roomId,
      userId: user.id,
      nickname: user.nickname,
      active: Boolean(payload.active),
    });
  });

  socket.on('chat:read', async (payload: { roomId?: string; messageId?: string }) => {
    if (!allowEvent(socket.id, 20) || !payload?.roomId || !payload.messageId) return;
    if (!socket.rooms.has(`room:${payload.roomId}`)) return;
    try {
      const response = await fetch(`${internalApiUrl}/api/messages`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: socket.handshake.headers.cookie || '',
        },
        body: JSON.stringify({ roomId: payload.roomId, messageId: payload.messageId }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return;
    } catch {
      return;
    }
    socket.to(`room:${payload.roomId}`).emit('chat:read', {
      ...payload,
      userId: user.id,
      readAt: new Date().toISOString(),
    });
  });

  socket.on('disconnecting', () => {
    if ((userConnectionCounts.get(user.id) || 0) > 1) return;
    for (const room of socket.rooms) {
      if (!room.startsWith('room:')) continue;
      socket.to(room).emit('presence:update', {
        roomId: room.slice(5),
        userId: user.id,
        status: 'offline',
      });
    }
  });

  socket.on('disconnect', () => {
    clearInterval(accessTimer);
    attempts.delete(socket.id);
    const remaining = Math.max(0, (userConnectionCounts.get(user.id) || 1) - 1);
    if (remaining === 0) userConnectionCounts.delete(user.id);
    else userConnectionCounts.set(user.id, remaining);
  });
});

server.listen(port, () => {
  const instanceId = crypto.randomBytes(3).toString('hex');
  process.stdout.write(`igwak-realtime:${instanceId} listening on ${port}\n`);
});

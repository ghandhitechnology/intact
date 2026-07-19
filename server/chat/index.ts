import http from 'http';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import {
  abandonEventDelivery,
  claimEventDelivery,
  completeEventDelivery,
  type DeliveryClaim,
} from './event-dedupe';
import {
  closeGatewayRedis,
  gatewayRedisStatus,
  initializeGatewayRedis,
} from './redis';

type SessionUser = {
  id: string;
  nickname: string;
  studentId: string;
  anonymousNickname: string;
  bSideEnabled: boolean;
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
const MAX_CONNECTIONS_PER_USER = 8;
const HANDSHAKE_LIMIT = 60;
const HANDSHAKE_WINDOW_MS = 10 * 60_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: webOrigin, credentials: true }));
app.get('/health', (_request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.json({
    ok: true,
    service: 'intact-realtime',
    connections: io.engine.clientsCount,
    redis: gatewayRedisStatus(),
  });
});

const server = http.createServer(app);
const handshakeAttempts = new Map<string, number[]>();

function handshakeIp(request: http.IncomingMessage) {
  const realIp = request.headers['x-real-ip'];
  return (typeof realIp === 'string' && realIp.length <= 64 ? realIp : request.socket.remoteAddress) || 'unknown';
}

function allowHandshake(request: http.IncomingMessage) {
  if (request.headers.origin !== webOrigin) return false;
  const now = Date.now();
  const ip = handshakeIp(request);
  const recent = (handshakeAttempts.get(ip) || []).filter((value) => now - value < HANDSHAKE_WINDOW_MS);
  if (recent.length >= HANDSHAKE_LIMIT) return false;
  recent.push(now);
  if (handshakeAttempts.size >= 10_000 && !handshakeAttempts.has(ip)) {
    for (const [key, values] of handshakeAttempts) {
      if (!values.some((value) => now - value < HANDSHAKE_WINDOW_MS)) handshakeAttempts.delete(key);
    }
    while (handshakeAttempts.size >= 10_000) {
      const oldest = handshakeAttempts.keys().next().value as string | undefined;
      if (!oldest) break;
      handshakeAttempts.delete(oldest);
    }
  }
  handshakeAttempts.set(ip, recent);
  return true;
}

const io = new Server(server, {
  cors: { origin: webOrigin, credentials: true },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 2 * 1024 * 1024,
  pingInterval: 25_000,
  pingTimeout: 20_000,
  allowRequest: (request, callback) => callback(null, allowHandshake(request)),
});

const platformNamespace = io.of('/platform');

function forwardPlatformInvalidation(raw: string) {
  try {
    const message = JSON.parse(raw) as {
      version?: unknown;
      bSideEnabled?: unknown;
      maintenanceEnabled?: unknown;
    };
    if (
      typeof message.version !== 'string'
      || typeof message.bSideEnabled !== 'boolean'
      || typeof message.maintenanceEnabled !== 'boolean'
    ) return;
    platformNamespace.emit('platform:invalidate', message);
  } catch {
    // Ignore malformed messages from the coordination channel.
  }
}

function internalRequestAllowed(request: express.Request) {
  const expected = process.env.INTERNAL_API_SECRET || '';
  const supplied = request.headers['x-igwak-internal'];
  if (!expected || typeof supplied !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

app.use('/internal', express.json({ limit: '128kb' }));

async function handleDedupedDelivery(
  request: express.Request,
  response: express.Response,
  deliver: () => Promise<void>,
) {
  const eventIdHeader = request.headers['x-igwak-event-id'];
  const eventId = typeof eventIdHeader === 'string' ? eventIdHeader : '';
  let claim: DeliveryClaim | null = null;
  try {
    if (eventId) {
      claim = await claimEventDelivery(eventId);
      if (!claim) {
        response.json({ ok: true, deduplicated: true });
        return;
      }
    }
    await deliver();
    if (claim) await completeEventDelivery(claim);
    response.json({ ok: true });
  } catch {
    if (claim) await abandonEventDelivery(claim).catch(() => undefined);
    response.status(503).json({ ok: false });
  }
}

type RealtimeMessage = {
  sender?: {
    id?: string;
    nickname?: string;
    realName?: string | null;
    profileImage?: string | null;
    studentIdentity?: { studentCode?: string } | null;
  };
  _bSide?: { enabled?: boolean; anonymousNickname?: string };
  [key: string]: unknown;
};

function messageForViewer(input: RealtimeMessage, viewerId: string) {
  const { _bSide, ...message } = input;
  if (!_bSide?.enabled || !message.sender || message.sender.id === viewerId) return message;
  const alias = _bSide.anonymousNickname || '#ANONYMOUS';
  return {
    ...message,
    sender: {
      ...message.sender,
      nickname: alias,
      realName: alias,
      profileImage: null,
      studentIdentity: message.sender.studentIdentity
        ? { ...message.sender.studentIdentity, studentCode: '------' }
        : message.sender.studentIdentity,
    },
  };
}

async function emitMessageToRoom(roomId: string, message: RealtimeMessage) {
  const sockets = await io.in(`room:${roomId}`).fetchSockets();
  for (const socket of sockets) {
    const viewer = socket.data.user as SessionUser | undefined;
    if (!viewer?.id) continue;
    socket.emit('chat:message', messageForViewer(message, viewer.id));
  }
}

app.post('/internal/message', async (request, response) => {
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
  await handleDedupedDelivery(request, response, async () => {
    await emitMessageToRoom(roomId, message as RealtimeMessage);
  });
});
app.post('/internal/room-created', async (request, response) => {
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
  await handleDedupedDelivery(request, response, async () => {
    for (const memberId of memberIds) {
      io.to(`user:${memberId}`).emit('room:created', { roomId });
    }
  });
});

const attempts = new Map<string, number[]>();
const userConnectionCounts = new Map<string, number>();

function releaseConnectionReservation(socket: Socket) {
  if (!socket.data.connectionReserved) return;
  socket.data.connectionReserved = false;
  const user = socket.data.user as SessionUser | undefined;
  if (!user) return;
  const remaining = Math.max(0, (userConnectionCounts.get(user.id) || 1) - 1);
  if (remaining === 0) userConnectionCounts.delete(user.id);
  else userConnectionCounts.set(user.id, remaining);
}

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
  if ((userConnectionCounts.get(user.id) || 0) >= MAX_CONNECTIONS_PER_USER) {
    next(new Error('CONNECTION_LIMIT'));
    return;
  }
  userConnectionCounts.set(user.id, (userConnectionCounts.get(user.id) || 0) + 1);
  socket.data.connectionReserved = true;
  socket.data.user = user;
  socket.data.reservationTimer = setTimeout(() => {
    if (!socket.connected) releaseConnectionReservation(socket);
  }, 10_000);
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user as SessionUser;
  clearTimeout(socket.data.reservationTimer);
  socket.join(`user:${user.id}`);

  const accessTimer = setInterval(async () => {
    const refreshed = await resolveSession(socket);
    if (!refreshed || refreshed.id !== user.id) {
      socket.disconnect(true);
      return;
    }
    Object.assign(user, refreshed);
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
    if (
      !allowEvent(socket.id, 12)
      || !input
      || typeof input.content !== 'string'
      || typeof input.roomId !== 'string'
      || typeof input.clientId !== 'string'
      || !SAFE_ID.test(input.roomId)
      || !SAFE_ID.test(input.clientId)
      || (input.replyToId !== undefined && (typeof input.replyToId !== 'string' || !SAFE_ID.test(input.replyToId)))
      || (input.type !== undefined && !['TEXT', 'IMAGE', 'FILE'].includes(input.type))
    ) {
      ack?.({ ok: false, error: 'INVALID_MESSAGE' });
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
      const body = (await response.json()) as RealtimeMessage & {
        message?: RealtimeMessage;
        data?: { message?: RealtimeMessage };
      };
      const message = body.data?.message ?? body.message ?? body;
      if (typeof message.id !== 'string') throw new Error('INVALID_PERSIST_RESPONSE');
      const queuedForOutbox = response.headers.get('x-realtime-delivery') === 'outbox';
      if (!queuedForOutbox) await emitMessageToRoom(input.roomId, message);
      ack?.({ ok: true, message: messageForViewer(message, user.id) });
    } catch {
      ack?.({ ok: false, error: 'DELIVERY_FAILED' });
    }
  });

  socket.on('chat:typing', (payload: { roomId?: string; active?: boolean }) => {
    if (
      !allowEvent(socket.id, 30)
      || typeof payload?.roomId !== 'string'
      || !SAFE_ID.test(payload.roomId)
      || !socket.rooms.has(`room:${payload.roomId}`)
    ) return;
    socket.to(`room:${payload.roomId}`).emit('chat:typing', {
      roomId: payload.roomId,
      userId: user.id,
      nickname: user.bSideEnabled ? user.anonymousNickname : user.nickname,
      active: Boolean(payload.active),
    });
  });

  socket.on('chat:read', async (payload: { roomId?: string; messageId?: string }) => {
    if (
      !allowEvent(socket.id, 20)
      || typeof payload?.roomId !== 'string'
      || typeof payload.messageId !== 'string'
      || !SAFE_ID.test(payload.roomId)
      || !SAFE_ID.test(payload.messageId)
    ) return;
    if (!socket.rooms.has(`room:${payload.roomId}`)) return;
    try {
      const response = await fetch(`${internalApiUrl}/api/messages`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: socket.handshake.headers.cookie || '',
          'x-igwak-realtime-origin': process.env.INTERNAL_API_SECRET || '',
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
    clearTimeout(socket.data.reservationTimer);
    attempts.delete(socket.id);
    releaseConnectionReservation(socket);
  });
});

async function start() {
  await initializeGatewayRedis(io, forwardPlatformInvalidation);
  server.listen(port, () => {
    const instanceId = crypto.randomBytes(3).toString('hex');
    process.stdout.write(`intact-realtime:${instanceId} listening on ${port}\n`);
  });
}

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`intact-realtime shutting down after ${signal}\n`);
  io.close(() => {
    void closeGatewayRedis().finally(() => {
      server.close(() => process.exit(0));
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`intact-realtime failed to start: ${message.slice(0, 500)}\n`);
  process.exit(1);
});

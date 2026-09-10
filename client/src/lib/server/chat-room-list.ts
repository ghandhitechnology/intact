import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { chatMemberSelect } from '@/lib/server/chat-members';

type RoomListClient = Pick<PrismaClient, 'chatRoom' | '$queryRaw'>;

type LatestMessageRow = {
  roomId: string;
  id: string;
  sequence: bigint;
  content: string;
  createdAt: Date;
  senderId: string;
  senderNickname: string;
  senderRealName: string | null;
};

export async function loadChatRoomList(userId: string, client: RoomListClient = prisma) {
  const rooms = await client.chatRoom.findMany({
    where: { members: { some: { userId, leftAt: null } } },
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    include: {
      members: {
        where: { leftAt: null },
        select: chatMemberSelect,
      },
    },
  });
  if (!rooms.length) return [];

  const roomIds = Prisma.join(rooms.map((room) => Prisma.sql`${room.id}::uuid`));
  const [latestMessages, unreadRows] = await Promise.all([
    // Prisma의 중첩 take는 방별 전체 메시지를 읽으므로 DB에서 방마다 한 건만 조회합니다.
    client.$queryRaw<LatestMessageRow[]>(Prisma.sql`
      SELECT room.id AS "roomId", latest.id, latest.sequence, latest.content,
             latest."createdAt", sender.id AS "senderId",
             sender.nickname AS "senderNickname", sender."realName" AS "senderRealName"
      FROM "ChatRoom" AS room
      CROSS JOIN LATERAL (
        SELECT message.id, message.sequence, message.content, message."createdAt", message."senderId"
        FROM "Message" AS message
        WHERE message."roomId" = room.id AND message."deletedAt" IS NULL
        ORDER BY message."createdAt" DESC
        LIMIT 1
      ) AS latest
      INNER JOIN "User" AS sender ON sender.id = latest."senderId"
      WHERE room.id IN (${roomIds})
    `),
    client.$queryRaw<Array<{ roomId: string; unreadCount: bigint }>>(Prisma.sql`
      SELECT message."roomId", COUNT(*)::bigint AS "unreadCount"
      FROM "Message" AS message
      INNER JOIN "ChatMember" AS membership
        ON membership."roomId" = message."roomId"
      WHERE membership."userId" = ${userId}::uuid
        AND membership."leftAt" IS NULL
        AND message."roomId" IN (${roomIds})
        AND message."deletedAt" IS NULL
        AND message."senderId" <> ${userId}::uuid
        AND message."createdAt" >= membership."joinedAt"
        AND message."sequence" > membership."lastReadSequence"
      GROUP BY message."roomId"
    `),
  ]);
  const latestByRoom = new Map(latestMessages.map((message) => [message.roomId, {
    id: message.id,
    sequence: message.sequence,
    content: message.content,
    createdAt: message.createdAt,
    sender: {
      id: message.senderId,
      nickname: message.senderNickname,
      realName: message.senderRealName,
    },
  }]));
  const unreadByRoom = new Map(unreadRows.map((row) => [row.roomId, Number(row.unreadCount)]));
  return rooms.map((room) => {
    const latest = latestByRoom.get(room.id);
    return {
      ...room,
      messages: latest ? [latest] : [],
      unreadCount: unreadByRoom.get(room.id) ?? 0,
    };
  });
}

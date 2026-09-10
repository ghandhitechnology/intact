import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { loadChatRoomList } from '../src/lib/server/chat-room-list';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('대화방 요약은 참여 권한, 삭제 메시지와 안 읽은 메시지 경계를 유지한다', {
  skip: !databaseUrl,
}, async () => {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const rollback = new Error('테스트 데이터 롤백');
  try {
    await assert.rejects(client.$transaction(async (tx) => {
      const viewerId = randomUUID();
      const peerId = randomUUID();
      await tx.user.createMany({
        data: [viewerId, peerId].map((id) => ({
          id,
          loginId: `test-${id.slice(0, 20)}`,
          nickname: `test-${id.slice(0, 20)}`,
          passwordHash: 'integration-test-only',
          role: 'TEACHER' as const,
        })),
      });
      const roomId = randomUUID();
      const emptyRoomId = randomUUID();
      const leftRoomId = randomUUID();
      const joinedAt = new Date('2026-01-02T00:00:00Z');
      await tx.chatRoom.createMany({
        data: [roomId, emptyRoomId, leftRoomId].map((id) => ({ id })),
      });
      await tx.chatMember.createMany({
        data: [
          { roomId, userId: viewerId, joinedAt, lastReadSequence: BigInt(2) },
          { roomId, userId: peerId, joinedAt, leftAt: joinedAt },
          { roomId: emptyRoomId, userId: viewerId, joinedAt },
          { roomId: leftRoomId, userId: viewerId, joinedAt, leftAt: joinedAt },
        ],
      });
      const sentAt = (seconds: number) => new Date(joinedAt.getTime() + seconds * 1_000);
      const latestId = randomUUID();
      await tx.message.createMany({
        data: [
          { sequence: BigInt(1), createdAt: sentAt(1), senderId: peerId },
          { sequence: BigInt(3), createdAt: sentAt(-1), senderId: peerId },
          { sequence: BigInt(4), createdAt: sentAt(4), senderId: viewerId },
          { sequence: BigInt(5), createdAt: sentAt(5), senderId: peerId },
          { id: latestId, sequence: BigInt('9007199254740993'), createdAt: sentAt(6), senderId: peerId },
          { sequence: BigInt('9007199254740994'), createdAt: sentAt(7), senderId: peerId, deletedAt: sentAt(8) },
        ].map((message) => ({ ...message, roomId, content: '합성 테스트 메시지' })),
      });

      const rooms = await loadChatRoomList(viewerId, tx);
      assert.deepEqual(new Set(rooms.map((room) => room.id)), new Set([roomId, emptyRoomId]));
      const summary = rooms.find((room) => room.id === roomId)!;
      assert.equal(summary.unreadCount, 2);
      assert.deepEqual(summary.members.map((member) => member.userId), [viewerId]);
      assert.equal(summary.messages.length, 1);
      assert.equal(summary.messages[0].id, latestId);
      assert.equal(summary.messages[0].sequence, BigInt('9007199254740993'));
      assert.equal(summary.messages[0].createdAt.toISOString(), sentAt(6).toISOString());
      assert.equal(summary.messages[0].sender.id, peerId);
      const empty = rooms.find((room) => room.id === emptyRoomId)!;
      assert.deepEqual(empty.messages, []);
      assert.equal(empty.unreadCount, 0);
      assert.deepEqual(await loadChatRoomList(peerId, tx), []);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally {
    await client.$disconnect();
  }
});

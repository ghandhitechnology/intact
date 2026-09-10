import prisma from '@/lib/prisma';
import { CHAT_ROOM_CAPACITY, chatTooManyMembersMessage } from '@/lib/chat-limits';
import { publicAuthorSelect } from '@/lib/server/content';
import { ApiError } from '@/lib/server/http';
import { getPlatformMode } from '@/lib/server/platform-mode';

const ANONYMOUS_ALIAS = /^#[A-F0-9]{8}$/i;
const USER_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const chatMemberSelect = {
  userId: true,
  role: true,
  notificationsMuted: true,
  joinedAt: true,
  lastReadSequence: true,
  lastReadMessage: { select: { createdAt: true, sequence: true } },
  user: { select: publicAuthorSelect },
} as const;

export function collectMemberIdentifiers(body: {
  memberIds?: unknown;
  recipientId?: unknown;
}) {
  if (Array.isArray(body.memberIds)) {
    return body.memberIds.filter((id): id is string => typeof id === 'string');
  }
  return typeof body.recipientId === 'string' ? [body.recipientId] : [];
}

export function assertInvitableMemberCount(count: number) {
  if (count < 1) {
    throw new ApiError(400, 'MEMBER_REQUIRED', '대화 상대를 한 명 이상 선택해 주세요.');
  }
  if (count > CHAT_ROOM_CAPACITY - 1) {
    throw new ApiError(400, 'TOO_MANY_MEMBERS', chatTooManyMembersMessage());
  }
}

export function assertRoomCapacity(activeCount: number, addingCount: number) {
  if (activeCount + addingCount > CHAT_ROOM_CAPACITY) {
    throw new ApiError(400, 'TOO_MANY_MEMBERS', chatTooManyMembersMessage());
  }
}

export async function requireActiveMembership(roomId: string, userId: string) {
  const membership = await prisma.chatMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, leftAt: true, notificationsMuted: true },
  });
  if (!membership || membership.leftAt) {
    throw new ApiError(403, 'NOT_A_ROOM_MEMBER', '이 대화방에 참여하고 있지 않습니다.');
  }
  return membership;
}

export async function resolveChatMemberIds(input: {
  identifiers: string[];
  actorId: string;
}) {
  const identifiers = Array.from(
    new Set(input.identifiers.map((id) => id.trim()).filter(Boolean)),
  );
  assertInvitableMemberCount(identifiers.length);

  const platformMode = await getPlatformMode();
  const anonymousIdentifiers = platformMode.bSideEnabled
    ? identifiers.filter((value) => ANONYMOUS_ALIAS.test(value))
    : [];
  const anonymousAliases = anonymousIdentifiers.length
    ? await prisma.platformAlias.findMany({
        where: {
          epoch: platformMode.bSideEpoch,
          alias: { in: anonymousIdentifiers.map((value) => value.toUpperCase()) },
        },
        select: { alias: true, userId: true },
      })
    : [];
  const uuidIdentifiers = identifiers.filter((value) => USER_UUID.test(value));
  const members = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { loginId: { in: identifiers } },
        { studentIdentity: { studentCode: { in: identifiers } } },
        ...(uuidIdentifiers.length ? [{ id: { in: uuidIdentifiers } }] : []),
      ],
    },
    select: {
      id: true,
      loginId: true,
      studentIdentity: { select: { studentCode: true } },
    },
  });
  const resolved = identifiers.map((identifier) => {
    if (platformMode.bSideEnabled && ANONYMOUS_ALIAS.test(identifier)) {
      return (
        anonymousAliases.find(
          (candidate) => candidate.alias.toLowerCase() === identifier.toLowerCase(),
        )?.userId ?? null
      );
    }
    return (
      members.find(
        (member) =>
          member.id === identifier ||
          member.loginId === identifier ||
          member.studentIdentity?.studentCode === identifier,
      )?.id ?? null
    );
  });
  if (resolved.some((id) => !id)) {
    throw new ApiError(400, 'INVALID_MEMBER', '대화할 수 없는 사용자가 포함되어 있습니다.');
  }
  const memberIds = resolved as string[];
  if (memberIds.includes(input.actorId)) {
    throw new ApiError(400, 'SELF_MEMBER', '본인은 대화 상대 목록에 넣지 않아도 됩니다.');
  }
  if (new Set(memberIds).size !== memberIds.length) {
    throw new ApiError(400, 'DUPLICATE_MEMBER', '같은 대화 상대가 중복으로 입력되었습니다.');
  }
  return memberIds;
}

export async function loadRoomWithMembers(roomId: string) {
  return prisma.chatRoom.findUniqueOrThrow({
    where: { id: roomId },
    include: {
      members: {
        where: { leftAt: null },
        include: { user: { select: publicAuthorSelect } },
      },
    },
  });
}

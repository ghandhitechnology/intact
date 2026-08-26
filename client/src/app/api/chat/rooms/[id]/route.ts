import { CHAT_MIN_GROUP_TITLE_LENGTH } from '@/lib/chat-limits';
import {
  loadRoomWithMembers,
  requireActiveMembership,
} from '@/lib/server/chat-members';
import { ApiError, assertSameOrigin, json, jsonError, readJson } from '@/lib/server/http';
import { maskPublicIdentities } from '@/lib/server/platform-mode';
import { requireUser } from '@/lib/server/session';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchRoomBody {
  title?: unknown;
  notificationsMuted?: unknown;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await context.params;
    assertSameOrigin(request);
    const session = await requireUser(request);
    await requireActiveMembership(roomId, session.user.id);
    const body = await readJson<PatchRoomBody>(request, 4_096);
    const wantsTitle = Object.prototype.hasOwnProperty.call(body, 'title');
    const wantsMute = Object.prototype.hasOwnProperty.call(body, 'notificationsMuted');
    if (!wantsTitle && !wantsMute) {
      throw new ApiError(400, 'PATCH_REQUIRED', '바꿀 대화방 정보를 입력해 주세요.');
    }

    if (wantsMute) {
      if (typeof body.notificationsMuted !== 'boolean') {
        throw new ApiError(400, 'INVALID_MUTE', '알림 설정이 올바르지 않습니다.');
      }
      await prisma.chatMember.update({
        where: { roomId_userId: { roomId, userId: session.user.id } },
        data: { notificationsMuted: body.notificationsMuted },
      });
    }

    if (wantsTitle) {
      if (typeof body.title !== 'string') {
        throw new ApiError(400, 'TITLE_REQUIRED', '그룹 대화방 이름을 입력해 주세요.');
      }
      const title = body.title.trim().slice(0, 120);
      if (title.length < CHAT_MIN_GROUP_TITLE_LENGTH) {
        throw new ApiError(400, 'TITLE_REQUIRED', '그룹 대화방 이름을 2자 이상 입력해 주세요.');
      }
      const room = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { type: true },
      });
      if (!room || room.type !== 'GROUP') {
        throw new ApiError(400, 'DIRECT_TITLE', '1:1 대화에는 이름을 붙일 수 없습니다.');
      }
      await prisma.chatRoom.update({
        where: { id: roomId },
        data: { title },
      });
    }

    const room = await loadRoomWithMembers(roomId);
    return json({ room: await maskPublicIdentities(room, session.user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

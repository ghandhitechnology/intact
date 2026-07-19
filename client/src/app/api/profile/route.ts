import prisma from '@/lib/prisma';
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { enrichPublicUserTree } from '@/lib/server/igk-standing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validateNickname(nickname: string) {
  const reserved = ['admin', 'administrator', '관리자', '운영자', '인텍트', '인텍트관리자'];
  if (
    !/^[\p{L}\p{N}_-]{2,16}$/u.test(nickname) ||
    reserved.includes(nickname.normalize('NFKC').toLowerCase())
  ) {
    throw new ApiError(
      400,
      'INVALID_NICKNAME',
      '닉네임에는 한글, 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.',
    );
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: {
        id: true,
        createdAt: true,
        nickname: true,
        realName: true,
        profileImage: true,
        profileImageAttachmentId: true,
        bio: true,
        interests: true,
        showRealName: true,
        showStudentCode: true,
        showActivityStats: true,
        role: true,
        status: true,
        currentIgk: true,
        lifetimeIgk: true,
        level: true,
        lastReverifiedAt: true,
        reverifyDueAt: true,
        studentIdentity: {
          select: {
            studentCode: true,
            generation: true,
            grade: true,
            classNumber: true,
            studentNumber: true,
            schoolYear: true,
          },
        },
        _count: { select: { posts: true, comments: true, bookmarks: true } },
      },
    });
    return json({ profile: await enrichPublicUserTree(profile) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`profile-update:${session.user.id}`, {
      limit: 10,
      windowMs: 24 * 60 * 60 * 1_000,
    });
    const body = await readJson<{
      nickname?: unknown;
      profileImage?: unknown;
      bio?: unknown;
      interests?: unknown;
      showRealName?: unknown;
      showStudentCode?: unknown;
      showActivityStats?: unknown;
    }>(request, 8_192);
    const nickname = body.nickname === undefined
      ? undefined
      : requiredString(body.nickname, '닉네임', { min: 2, max: 16 });
    if (nickname) validateNickname(nickname);
    const profileImage = body.profileImage === undefined
      ? undefined
      : body.profileImage === null || body.profileImage === ''
        ? null
        : requiredString(body.profileImage, '프로필 이미지 주소', { max: 2_048 });
    if (profileImage) {
      let parsed: URL;
      try {
        parsed = new URL(profileImage);
      } catch {
        throw new ApiError(400, 'INVALID_PROFILE_IMAGE', '올바른 이미지 주소를 입력해 주세요.');
      }
      if (parsed.protocol !== 'https:') {
        throw new ApiError(400, 'INVALID_PROFILE_IMAGE', 'HTTPS 이미지 주소만 사용할 수 있습니다.');
      }
    }
    const bio = body.bio === undefined
      ? undefined
      : typeof body.bio === 'string'
        ? body.bio.trim().slice(0, 280) || null
        : null;
    const interests = body.interests === undefined
      ? undefined
      : Array.isArray(body.interests)
        ? Array.from(
            new Set(
              body.interests
                .filter((interest): interest is string => typeof interest === 'string')
                .map((interest) => interest.normalize('NFKC').trim())
                .filter(Boolean),
            ),
          )
            .slice(0, 5)
            .map((interest) => interest.slice(0, 24))
        : [];
    const showRealName = typeof body.showRealName === 'boolean' ? body.showRealName : undefined;
    const showStudentCode = typeof body.showStudentCode === 'boolean' ? body.showStudentCode : undefined;
    const showActivityStats = typeof body.showActivityStats === 'boolean' ? body.showActivityStats : undefined;
    if (
      nickname === undefined
      && profileImage === undefined
      && bio === undefined
      && interests === undefined
      && showRealName === undefined
      && showStudentCode === undefined
      && showActivityStats === undefined
    ) {
      throw new ApiError(400, 'NO_CHANGES', '변경할 프로필 항목이 없습니다.');
    }
    const profile = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        nickname,
        profileImage,
        bio,
        interests,
        showRealName,
        showStudentCode,
        showActivityStats,
      },
      select: {
        id: true,
        nickname: true,
        realName: true,
        profileImage: true,
        bio: true,
        interests: true,
        showRealName: true,
        showStudentCode: true,
        showActivityStats: true,
        level: true,
      },
    });
    return json({ profile });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonError(new ApiError(409, 'NICKNAME_TAKEN', '이미 사용 중인 닉네임입니다.'));
    }
    return jsonError(error);
  }
}

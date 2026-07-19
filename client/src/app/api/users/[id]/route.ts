import prisma from '@/lib/prisma';
import { ApiError, json, jsonError } from '@/lib/server/http';
import { getPlatformMode, maskPublicIdentities } from '@/lib/server/platform-mode';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(request);
    const viewerVerified = await prisma.studentIdentity.count({ where: { userId: session.user.id } });
    if (!viewerVerified) throw new ApiError(403, 'STUDENT_ONLY', '인증된 학생만 프로필을 볼 수 있습니다.');
    const { id } = await context.params;
    const user = await prisma.user.findFirst({
      where: { id, status: 'ACTIVE', studentIdentity: { isNot: null } },
      select: {
        id: true,
        createdAt: true,
        nickname: true,
        realName: true,
        profileImage: true,
        profileImageAttachmentId: true,
        bio: true,
        interests: true,
        level: true,
        showRealName: true,
        showStudentCode: true,
        showActivityStats: true,
        studentIdentity: { select: { studentCode: true } },
        items: { where: { equipped: true }, select: { itemId: true } },
      },
    });
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', '프로필을 찾을 수 없습니다.');
    const ownProfile = user.id === session.user.id;
    const includeStats = ownProfile || user.showActivityStats;
    const [postCount, commentCount, recommendationSummary] = includeStats
      ? await Promise.all([
          prisma.post.count({ where: { authorId: user.id, status: 'PUBLISHED' } }),
          prisma.comment.count({ where: { authorId: user.id, status: 'PUBLISHED' } }),
          prisma.post.aggregate({
            where: { authorId: user.id, status: 'PUBLISHED' },
            _sum: { recommendationCount: true },
          }),
        ])
      : [null, null, null];
    const mode = await getPlatformMode();
    const shareIdentity = !mode.bSideEnabled || ownProfile;
    const profile = {
      id: user.id,
      createdAt: user.createdAt,
      nickname: user.nickname,
      realName: shareIdentity && (ownProfile || user.showRealName) ? user.realName : null,
      profileImage: user.profileImage,
      profileImageAttachmentId: user.profileImageAttachmentId,
      bio: user.bio,
      interests: user.interests,
      level: user.level,
      studentIdentity: shareIdentity && (ownProfile || user.showStudentCode) ? user.studentIdentity : null,
      items: user.items,
      activityStats: shareIdentity && includeStats
        ? {
            posts: postCount,
            comments: commentCount,
            recommendations: recommendationSummary?._sum.recommendationCount ?? 0,
          }
        : null,
    };
    return json({ profile: await maskPublicIdentities(profile, session.user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

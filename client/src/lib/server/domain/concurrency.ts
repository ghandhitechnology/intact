export interface EngagementTarget {
  postId: string | null;
  commentId: string | null;
}

function targetKey(target: EngagementTarget) {
  return target.postId ? `post:${target.postId}` : `comment:${target.commentId!}`;
}

export function reportLockKey(reporterId: string, targetType: string, targetId: string) {
  return `report:${reporterId}:${targetType}:${targetId}`;
}

export function recommendationLockKeys(
  userId: string,
  target: EngagementTarget,
  parentPostId?: string | null,
) {
  const targetResource = targetKey(target);
  return [
    targetResource,
    `recommendation:${userId}:${targetResource}`,
    ...(parentPostId && !target.postId ? [`post:${parentPostId}`] : []),
  ];
}

export function bookmarkLockKeys(userId: string, postId: string) {
  return [`post:${postId}`, `bookmark:${userId}:post:${postId}`];
}

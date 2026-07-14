-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'TEACHER', 'MODERATOR', 'ADMIN', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_REVERIFICATION', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BoardStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('STANDARD', 'QUESTION', 'RECRUITMENT', 'RESOURCE');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'POST', 'COMMENT', 'MESSAGE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SanctionType" AS ENUM ('WARNING', 'TEMPORARY_SUSPENSION', 'PERMANENT_BAN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('COMMENT', 'REPLY', 'MENTION', 'RECOMMENDATION', 'ANSWER_ACCEPTED', 'MESSAGE', 'NOTICE', 'SANCTION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatRoomType" AS ENUM ('DIRECT', 'GROUP');

-- CreateEnum
CREATE TYPE "ChatMemberRole" AS ENUM ('OWNER', 'MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "IgkTransactionType" AS ENUM ('POST_CREATED', 'COMMENT_CREATED', 'RECOMMENDATION_RECEIVED', 'ANSWER_ACCEPTED', 'TRANSFER_SENT', 'TRANSFER_RECEIVED', 'REVERSAL', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('BUG', 'FEATURE', 'ACCOUNT', 'CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "loginId" VARCHAR(32) NOT NULL,
    "nickname" VARCHAR(32) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "profileImage" VARCHAR(2048),
    "bio" VARCHAR(280),
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentIgk" INTEGER NOT NULL DEFAULT 0,
    "lifetimeIgk" INTEGER NOT NULL DEFAULT 0,
    "igkDebt" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(6),
    "lastReverifiedAt" TIMESTAMPTZ(6),
    "reverifyDueAt" TIMESTAMPTZ(6),
    "withdrawnAt" TIMESTAMPTZ(6),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "studentCode" CHAR(6) NOT NULL,
    "currentStudentNumber" CHAR(4) NOT NULL,
    "generation" INTEGER NOT NULL,
    "grade" INTEGER NOT NULL,
    "classNumber" INTEGER NOT NULL,
    "studentNumber" INTEGER NOT NULL,
    "encryptedName" TEXT NOT NULL,
    "nameFingerprint" CHAR(64) NOT NULL,
    "riroAccountFingerprint" CHAR(64) NOT NULL,
    "schoolYear" INTEGER NOT NULL,
    "verifiedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationTicket" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "tokenHash" CHAR(64) NOT NULL,
    "purpose" VARCHAR(16) NOT NULL DEFAULT 'REGISTER',
    "encryptedName" TEXT NOT NULL,
    "nameFingerprint" CHAR(64) NOT NULL,
    "riroAccountFingerprint" CHAR(64) NOT NULL,
    "studentCode" CHAR(6) NOT NULL,
    "currentStudentNumber" CHAR(4) NOT NULL,
    "generation" INTEGER NOT NULL,
    "grade" INTEGER NOT NULL,
    "classNumber" INTEGER NOT NULL,
    "studentNumber" INTEGER NOT NULL,
    "schoolYear" INTEGER NOT NULL,

    CONSTRAINT "VerificationTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "tokenHash" CHAR(64) NOT NULL,
    "scope" VARCHAR(16) NOT NULL DEFAULT 'PORTAL',
    "userId" UUID NOT NULL,
    "userAgent" VARCHAR(512),
    "ipHash" CHAR(64),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "kind" "PostKind" NOT NULL DEFAULT 'STANDARD',
    "status" "BoardStatus" NOT NULL DEFAULT 'ACTIVE',
    "icon" VARCHAR(64),
    "accentColor" VARCHAR(16),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "allowAttachments" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "publishedAt" TIMESTAMPTZ(6),
    "scheduledFor" TIMESTAMPTZ(6),
    "editedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "boardId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "acceptedCommentId" UUID,
    "kind" "PostKind" NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'PUBLISHED',
    "title" VARCHAR(180) NOT NULL,
    "content" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "bookmarkCount" INTEGER NOT NULL DEFAULT 0,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostRevision" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postId" UUID NOT NULL,
    "editorId" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "content" TEXT NOT NULL,
    "reason" VARCHAR(300),

    CONSTRAINT "PostRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaderId" UUID NOT NULL,
    "postId" UUID,
    "messageId" UUID,
    "storageKey" VARCHAR(512) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(127) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scanStatus" VARCHAR(32) NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "editedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "postId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "parentId" UUID,
    "status" "CommentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "content" TEXT NOT NULL,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "postId" UUID,
    "commentId" UUID,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "folder" VARCHAR(60),

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "reporterId" UUID NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetUserId" UUID,
    "postId" UUID,
    "commentId" UUID,
    "messageId" UUID,
    "reasonCode" VARCHAR(40) NOT NULL,
    "detail" VARCHAR(1000),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" VARCHAR(1000),
    "resolvedAt" TIMESTAMPTZ(6),
    "resolvedById" UUID,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sanction" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetUserId" UUID NOT NULL,
    "issuedById" UUID,
    "type" "SanctionType" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" UUID,

    CONSTRAINT "Sanction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "actorId" UUID,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(500),
    "href" VARCHAR(2048),
    "metadata" JSONB,
    "readAt" TIMESTAMPTZ(6),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRoom" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "type" "ChatRoomType" NOT NULL DEFAULT 'GROUP',
    "title" VARCHAR(120),
    "createdById" UUID,
    "directKey" VARCHAR(80),
    "lastMessageAt" TIMESTAMPTZ(6),

    CONSTRAINT "ChatRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(6),
    "role" "ChatMemberRole" NOT NULL DEFAULT 'MEMBER',
    "lastReadMessageId" UUID,
    "mutedUntil" TIMESTAMPTZ(6),

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "roomId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "replyToId" UUID,
    "clientId" VARCHAR(160),
    "content" TEXT NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgkLedger" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "counterpartyId" UUID,
    "type" "IgkTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "lifetimeAfter" INTEGER NOT NULL,
    "sourceType" VARCHAR(40),
    "sourceId" VARCHAR(80),
    "transferId" UUID,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "note" VARCHAR(300),
    "metadata" JSONB,

    CONSTRAINT "IgkLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelRule" (
    "level" INTEGER NOT NULL,
    "minimumLifetimeIgk" INTEGER NOT NULL,
    "label" VARCHAR(60),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "LevelRule_pkey" PRIMARY KEY ("level")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "authorId" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "content" TEXT NOT NULL,
    "status" "NoticeStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "targetAudience" VARCHAR(60) NOT NULL DEFAULT 'ALL',
    "publishedAt" TIMESTAMPTZ(6),
    "scheduledFor" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminId" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(40) NOT NULL,
    "targetId" VARCHAR(80),
    "reason" VARCHAR(1000) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipHash" CHAR(64),

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "requesterId" UUID NOT NULL,
    "assignedToId" UUID,
    "category" "SupportCategory" NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "subject" VARCHAR(180) NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" VARCHAR(2000),
    "resolvedAt" TIMESTAMPTZ(6),
    "metadata" JSONB,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

-- CreateIndex
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_lifetimeIgk_idx" ON "User"("lifetimeIgk" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "StudentIdentity_userId_key" ON "StudentIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentIdentity_studentCode_key" ON "StudentIdentity"("studentCode");

-- CreateIndex
CREATE UNIQUE INDEX "StudentIdentity_nameFingerprint_key" ON "StudentIdentity"("nameFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "StudentIdentity_riroAccountFingerprint_key" ON "StudentIdentity"("riroAccountFingerprint");

-- CreateIndex
CREATE INDEX "StudentIdentity_schoolYear_grade_classNumber_idx" ON "StudentIdentity"("schoolYear", "grade", "classNumber");

-- CreateIndex
CREATE INDEX "StudentIdentity_generation_idx" ON "StudentIdentity"("generation");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationTicket_tokenHash_key" ON "VerificationTicket"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationTicket_expiresAt_usedAt_idx" ON "VerificationTicket"("expiresAt", "usedAt");

-- CreateIndex
CREATE INDEX "VerificationTicket_studentCode_idx" ON "VerificationTicket"("studentCode");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_scope_revokedAt_expiresAt_idx" ON "Session"("userId", "scope", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Board_slug_key" ON "Board"("slug");

-- CreateIndex
CREATE INDEX "Board_status_sortOrder_idx" ON "Board"("status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Post_acceptedCommentId_key" ON "Post"("acceptedCommentId");

-- CreateIndex
CREATE INDEX "Post_boardId_status_isPinned_publishedAt_idx" ON "Post"("boardId", "status", "isPinned" DESC, "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Post_authorId_status_createdAt_idx" ON "Post"("authorId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Post_status_recommendationCount_publishedAt_idx" ON "Post"("status", "recommendationCount" DESC, "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Post_tags_idx" ON "Post" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "PostRevision_postId_createdAt_idx" ON "PostRevision"("postId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_postId_idx" ON "Attachment"("postId");

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- CreateIndex
CREATE INDEX "Attachment_uploaderId_createdAt_idx" ON "Attachment"("uploaderId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Comment_postId_status_createdAt_idx" ON "Comment"("postId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_status_createdAt_idx" ON "Comment"("authorId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- CreateIndex
CREATE INDEX "Recommendation_postId_createdAt_idx" ON "Recommendation"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_commentId_createdAt_idx" ON "Recommendation"("commentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_userId_postId_key" ON "Recommendation"("userId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_userId_commentId_key" ON "Recommendation"("userId", "commentId");

-- CreateIndex
CREATE INDEX "Bookmark_userId_folder_createdAt_idx" ON "Bookmark"("userId", "folder", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_userId_postId_key" ON "Bookmark"("userId", "postId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetType_createdAt_idx" ON "Report"("targetType", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reporterId_createdAt_idx" ON "Report"("reporterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Sanction_targetUserId_revokedAt_endsAt_idx" ON "Sanction"("targetUserId", "revokedAt", "endsAt");

-- CreateIndex
CREATE INDEX "Sanction_createdAt_idx" ON "Sanction"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoom_directKey_key" ON "ChatRoom"("directKey");

-- CreateIndex
CREATE INDEX "ChatRoom_lastMessageAt_idx" ON "ChatRoom"("lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "ChatMember_userId_leftAt_idx" ON "ChatMember"("userId", "leftAt");

-- CreateIndex
CREATE INDEX "Message_roomId_createdAt_idx" ON "Message"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Message_clientId_key" ON "Message"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "IgkLedger_idempotencyKey_key" ON "IgkLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IgkLedger_userId_createdAt_idx" ON "IgkLedger"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "IgkLedger_type_createdAt_idx" ON "IgkLedger"("type", "createdAt");

-- CreateIndex
CREATE INDEX "IgkLedger_transferId_idx" ON "IgkLedger"("transferId");

-- CreateIndex
CREATE INDEX "IgkLedger_sourceType_sourceId_idx" ON "IgkLedger"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "LevelRule_minimumLifetimeIgk_key" ON "LevelRule"("minimumLifetimeIgk");

-- CreateIndex
CREATE INDEX "LevelRule_minimumLifetimeIgk_idx" ON "LevelRule"("minimumLifetimeIgk");

-- CreateIndex
CREATE INDEX "Notice_status_priority_publishedAt_idx" ON "Notice"("status", "priority" DESC, "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Notice_expiresAt_idx" ON "Notice"("expiresAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_createdAt_idx" ON "AdminAuditLog"("targetType", "targetId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "StudentIdentity" ADD CONSTRAINT "StudentIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_acceptedCommentId_fkey" FOREIGN KEY ("acceptedCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostRevision" ADD CONSTRAINT "PostRevision_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostRevision" ADD CONSTRAINT "PostRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_lastReadMessageId_fkey" FOREIGN KEY ("lastReadMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgkLedger" ADD CONSTRAINT "IgkLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgkLedger" ADD CONSTRAINT "IgkLedger_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelRule" ADD CONSTRAINT "LevelRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "SupportTicket_requesterId_createdAt_idx" ON "SupportTicket"("requesterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedToId_status_idx" ON "SupportTicket"("assignedToId", "status");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the canonical first-party boards and level thresholds. These stable IDs
-- keep local, staging, and production environments aligned from day one.
INSERT INTO "Board" ("id", "createdAt", "updatedAt", "slug", "name", "description", "kind", "status", "icon", "accentColor", "sortOrder", "allowAttachments") VALUES
('00000000-0000-4000-8000-000000000101', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'question', '질문게시판', '수업, 연구, 학교생활에 관해 묻고 답하는 공간', 'QUESTION', 'ACTIVE', 'circle-help', '#167A5A', 10, true),
('00000000-0000-4000-8000-000000000102', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'contest', '대회모집', '대회와 프로젝트의 팀원을 찾는 공간', 'RECRUITMENT', 'ACTIVE', 'users', '#1666A8', 20, true),
('00000000-0000-4000-8000-000000000103', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'resources', '자료공유', '학습 및 연구 자료를 안전하게 나누는 공간', 'RESOURCE', 'ACTIVE', 'folder-open', '#2B7A9B', 30, true),
('00000000-0000-4000-8000-000000000104', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'free', '자유게시판', '학교 구성원들이 자유롭게 이야기하는 공간', 'STANDARD', 'ACTIVE', 'messages-square', '#24806A', 40, true);

INSERT INTO "LevelRule" ("level", "minimumLifetimeIgk", "label", "updatedAt") VALUES
(1, 0, '새싹', CURRENT_TIMESTAMP),
(2, 100, '탐구자', CURRENT_TIMESTAMP),
(3, 250, '연구자', CURRENT_TIMESTAMP),
(4, 500, '발견자', CURRENT_TIMESTAMP),
(5, 1000, '개척자', CURRENT_TIMESTAMP),
(6, 2000, '인곽인', CURRENT_TIMESTAMP),
(7, 3500, '별빛', CURRENT_TIMESTAMP),
(8, 5750, '은하', CURRENT_TIMESTAMP),
(9, 9125, '초신성', CURRENT_TIMESTAMP),
(10, 14190, '전설', CURRENT_TIMESTAMP);

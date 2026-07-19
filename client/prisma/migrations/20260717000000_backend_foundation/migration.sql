-- Backend reliability, messaging, moderation, lifecycle, notification, support, and search foundations.
-- All changes are additive. Legacy compatibility columns remain in place.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Monotonic optimistic-concurrency versions.
ALTER TABLE "Post"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ModerationSubmission"
    ADD COLUMN "transitionVersion" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "leaseToken" UUID;

ALTER TABLE "Post"
    ADD CONSTRAINT "Post_version_positive_check"
    CHECK ("version" > 0) NOT VALID;

ALTER TABLE "ModerationSubmission"
    ADD CONSTRAINT "ModerationSubmission_transitionVersion_nonnegative_check"
    CHECK ("transitionVersion" >= 0) NOT VALID;

CREATE INDEX "ModerationSubmission_state_leaseExpiresAt_idx"
    ON "ModerationSubmission"("state", "leaseExpiresAt");

-- Attachment processing/finalization state. scanStatus remains the compatibility status field.
ALTER TABLE "Attachment"
    ADD COLUMN "processingError" VARCHAR(1000),
    ADD COLUMN "finalizedAt" TIMESTAMPTZ(6);

ALTER TABLE "Attachment"
    ADD CONSTRAINT "Attachment_finalizedAt_order_check"
    CHECK ("finalizedAt" IS NULL OR "finalizedAt" >= "createdAt") NOT VALID,
    ADD CONSTRAINT "Attachment_dimensions_positive_check"
    CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)) NOT VALID,
    ADD CONSTRAINT "Attachment_size_nonnegative_check"
    CHECK ("sizeBytes" >= 0) NOT VALID;

CREATE INDEX "Attachment_scanStatus_createdAt_idx"
    ON "Attachment"("scanStatus", "createdAt");
CREATE INDEX "Attachment_finalizedAt_idx"
    ON "Attachment"("finalizedAt");

-- Stable aliases within each platform epoch.
CREATE TABLE "PlatformAlias" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "epoch" INTEGER NOT NULL,
    "alias" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    CONSTRAINT "PlatformAlias_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformAlias_epoch_nonnegative_check" CHECK ("epoch" >= 0),
    CONSTRAINT "PlatformAlias_alias_nonempty_check" CHECK (length(btrim("alias")) > 0)
);

CREATE UNIQUE INDEX "PlatformAlias_epoch_alias_key"
    ON "PlatformAlias"("epoch", "alias");
CREATE UNIQUE INDEX "PlatformAlias_epoch_userId_key"
    ON "PlatformAlias"("epoch", "userId");
CREATE INDEX "PlatformAlias_userId_epoch_idx"
    ON "PlatformAlias"("userId", "epoch" DESC);
CREATE INDEX "PlatformAlias_alias_trgm_idx"
    ON "PlatformAlias" USING GIN ("alias" gin_trgm_ops);

ALTER TABLE "PlatformAlias"
    ADD CONSTRAINT "PlatformAlias_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-room message ordering and idempotent request identity.
ALTER TABLE "ChatRoom"
    ADD COLUMN "nextMessageSequence" BIGINT NOT NULL DEFAULT 1;

ALTER TABLE "Message"
    ADD COLUMN "sequence" BIGINT,
    ADD COLUMN "requestHash" CHAR(64);

ALTER TABLE "ChatMember"
    ADD COLUMN "lastReadSequence" BIGINT NOT NULL DEFAULT 0;

WITH ranked_messages AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "roomId"
            ORDER BY "createdAt", "id"
        )::BIGINT AS "backfilledSequence"
    FROM "Message"
)
UPDATE "Message" AS message
SET "sequence" = ranked_messages."backfilledSequence"
FROM ranked_messages
WHERE message."id" = ranked_messages."id";

ALTER TABLE "Message"
    ALTER COLUMN "sequence" SET NOT NULL;

UPDATE "ChatRoom" AS room
SET "nextMessageSequence" = COALESCE((
    SELECT max(message."sequence") + 1
    FROM "Message" AS message
    WHERE message."roomId" = room."id"
), 1);

UPDATE "ChatMember" AS member
SET "lastReadSequence" = message."sequence"
FROM "Message" AS message
WHERE member."lastReadMessageId" = message."id"
  AND member."roomId" = message."roomId";

ALTER TABLE "ChatRoom"
    ADD CONSTRAINT "ChatRoom_nextMessageSequence_positive_check"
    CHECK ("nextMessageSequence" > 0) NOT VALID;
ALTER TABLE "Message"
    ADD CONSTRAINT "Message_sequence_positive_check"
    CHECK ("sequence" > 0) NOT VALID;
ALTER TABLE "ChatMember"
    ADD CONSTRAINT "ChatMember_lastReadSequence_nonnegative_check"
    CHECK ("lastReadSequence" >= 0) NOT VALID;

CREATE UNIQUE INDEX "Message_roomId_sequence_key"
    ON "Message"("roomId", "sequence");
CREATE INDEX "Message_roomId_senderId_requestHash_idx"
    ON "Message"("roomId", "senderId", "requestHash");

-- Transactional outbox with retry scheduling, leases, and optional semantic deduplication.
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "aggregateType" VARCHAR(80),
    "aggregateId" VARCHAR(100),
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "dedupeKey" VARCHAR(160),
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 10,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(6),
    "publishedAt" TIMESTAMPTZ(6),
    "lastError" VARCHAR(2000),
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutboxEvent_attempts_check"
        CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts"),
    CONSTRAINT "OutboxEvent_lease_pair_check"
        CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)),
    CONSTRAINT "OutboxEvent_eventType_nonempty_check"
        CHECK (length(btrim("eventType")) > 0)
);

CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key"
    ON "OutboxEvent"("dedupeKey");
CREATE INDEX "OutboxEvent_publishedAt_availableAt_idx"
    ON "OutboxEvent"("publishedAt", "availableAt");
CREATE INDEX "OutboxEvent_leaseExpiresAt_idx"
    ON "OutboxEvent"("leaseExpiresAt");
CREATE INDEX "OutboxEvent_eventType_createdAt_idx"
    ON "OutboxEvent"("eventType", "createdAt");
CREATE INDEX "OutboxEvent_pending_availableAt_idx"
    ON "OutboxEvent"("availableAt", "createdAt")
    WHERE "publishedAt" IS NULL;

-- Notification delivery preferences and Web Push endpoint lifecycle.
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "endpointHash" CHAR(64) NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" VARCHAR(512),
    "expiresAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMPTZ(6),
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PushSubscription_failureCount_nonnegative_check" CHECK ("failureCount" >= 0),
    CONSTRAINT "PushSubscription_endpoint_nonempty_check" CHECK (length(btrim("endpoint")) > 0)
);

CREATE UNIQUE INDEX "NotificationPreference_userId_type_key"
    ON "NotificationPreference"("userId", "type");
CREATE INDEX "NotificationPreference_userId_pushEnabled_idx"
    ON "NotificationPreference"("userId", "pushEnabled");
CREATE UNIQUE INDEX "PushSubscription_endpointHash_key"
    ON "PushSubscription"("endpointHash");
CREATE INDEX "PushSubscription_userId_revokedAt_idx"
    ON "PushSubscription"("userId", "revokedAt");
CREATE INDEX "PushSubscription_revokedAt_expiresAt_idx"
    ON "PushSubscription"("revokedAt", "expiresAt");

ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription"
    ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Support conversation and status transition history.
CREATE TABLE "SupportMessage" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportMessage_body_nonempty_check" CHECK (length(btrim("body")) > 0)
);

CREATE TABLE "SupportStatusEvent" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" UUID NOT NULL,
    "changedById" UUID,
    "fromStatus" "SupportStatus",
    "toStatus" "SupportStatus" NOT NULL,
    "note" VARCHAR(1000),
    CONSTRAINT "SupportStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportMessage_ticketId_createdAt_idx"
    ON "SupportMessage"("ticketId", "createdAt");
CREATE INDEX "SupportMessage_authorId_createdAt_idx"
    ON "SupportMessage"("authorId", "createdAt" DESC);
CREATE INDEX "SupportStatusEvent_ticketId_createdAt_idx"
    ON "SupportStatusEvent"("ticketId", "createdAt");
CREATE INDEX "SupportStatusEvent_changedById_createdAt_idx"
    ON "SupportStatusEvent"("changedById", "createdAt" DESC);

ALTER TABLE "SupportMessage"
    ADD CONSTRAINT "SupportMessage_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "SupportMessage_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportStatusEvent"
    ADD CONSTRAINT "SupportStatusEvent_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "SupportStatusEvent_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Reports may become targetless after an ON DELETE SET NULL action, but never point at
-- multiple targets or a target that disagrees with targetType.
ALTER TABLE "Report"
    ADD CONSTRAINT "Report_single_matching_target_check"
    CHECK (
        num_nonnulls("targetUserId", "postId", "commentId", "messageId") <= 1
        AND ("targetUserId" IS NULL OR "targetType" = 'USER')
        AND ("postId" IS NULL OR "targetType" = 'POST')
        AND ("commentId" IS NULL OR "targetType" = 'COMMENT')
        AND ("messageId" IS NULL OR "targetType" = 'MESSAGE')
    ) NOT VALID;

CREATE UNIQUE INDEX "Report_one_active_user_per_reporter_key"
    ON "Report"("reporterId", "targetUserId")
    WHERE "targetType" = 'USER'
      AND "targetUserId" IS NOT NULL
      AND "status" IN ('OPEN', 'REVIEWING');
CREATE UNIQUE INDEX "Report_one_active_post_per_reporter_key"
    ON "Report"("reporterId", "postId")
    WHERE "targetType" = 'POST'
      AND "postId" IS NOT NULL
      AND "status" IN ('OPEN', 'REVIEWING');
CREATE UNIQUE INDEX "Report_one_active_comment_per_reporter_key"
    ON "Report"("reporterId", "commentId")
    WHERE "targetType" = 'COMMENT'
      AND "commentId" IS NOT NULL
      AND "status" IN ('OPEN', 'REVIEWING');
CREATE UNIQUE INDEX "Report_one_active_message_per_reporter_key"
    ON "Report"("reporterId", "messageId")
    WHERE "targetType" = 'MESSAGE'
      AND "messageId" IS NOT NULL
      AND "status" IN ('OPEN', 'REVIEWING');

-- A transfer has at most one sent and one received ledger side; each side is signed
-- and carries a distinct counterparty. Cross-row reciprocity remains transactional logic.
ALTER TABLE "IgkLedger"
    ADD CONSTRAINT "IgkLedger_transfer_shape_check"
    CHECK (
        ("type" NOT IN ('TRANSFER_SENT', 'TRANSFER_RECEIVED'))
        OR (
            "transferId" IS NOT NULL
            AND "counterpartyId" IS NOT NULL
            AND "userId" <> "counterpartyId"
            AND (
                ("type" = 'TRANSFER_SENT' AND "amount" < 0)
                OR ("type" = 'TRANSFER_RECEIVED' AND "amount" > 0)
            )
        )
    ) NOT VALID;

CREATE UNIQUE INDEX "IgkLedger_transferId_type_pair_key"
    ON "IgkLedger"("transferId", "type")
    WHERE "transferId" IS NOT NULL
      AND "type" IN ('TRANSFER_SENT', 'TRANSFER_RECEIVED');
CREATE INDEX "IgkLedger_transfer_pair_lookup_idx"
    ON "IgkLedger"("transferId", "userId", "counterpartyId", "type")
    WHERE "transferId" IS NOT NULL;

-- PostgreSQL-native generated search data intentionally stays out of Prisma because
-- Prisma does not expose generated tsvector fields portably.
ALTER TABLE "Post"
    ADD COLUMN "searchVector" TSVECTOR
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce("title", '')), 'A')
        || setweight(to_tsvector('simple', coalesce("contentText", '')), 'B')
    ) STORED;

CREATE INDEX "Post_searchVector_idx"
    ON "Post" USING GIN ("searchVector");
CREATE INDEX "Post_title_trgm_idx"
    ON "Post" USING GIN ("title" gin_trgm_ops);

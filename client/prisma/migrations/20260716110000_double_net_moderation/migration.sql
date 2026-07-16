ALTER TYPE "PostStatus" ADD VALUE IF NOT EXISTS 'PENDING_MODERATION';

CREATE TYPE "ModerationState" AS ENUM ('QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'ALLOWED', 'BLOCKED', 'FAILED', 'SUPERSEDED');
CREATE TYPE "ModerationDecision" AS ENUM ('ALLOW', 'REVIEW', 'BLOCK');
CREATE TYPE "ModerationRuleKind" AS ENUM ('TERM', 'REGEX', 'ALLOWLIST', 'TARGET_ALIAS', 'IMAGE_HASH');

CREATE TABLE "ModerationSubmission" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "postId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "reviewedById" UUID,
    "basePostUpdatedAt" TIMESTAMPTZ(6),
    "inputHash" CHAR(64) NOT NULL,
    "state" "ModerationState" NOT NULL DEFAULT 'QUEUED',
    "decision" "ModerationDecision",
    "riskScore" DOUBLE PRECISION,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetSpans" JSONB,
    "evidence" JSONB,
    "safeContext" BOOLEAN,
    "evasionDetected" BOOLEAN NOT NULL DEFAULT false,
    "explanationKo" VARCHAR(1000),
    "normalizedText" TEXT NOT NULL,
    "ocrText" TEXT,
    "localSignals" JSONB,
    "lunaResult" JSONB,
    "candidateTitle" VARCHAR(180) NOT NULL,
    "candidateContent" TEXT NOT NULL,
    "candidateContentText" TEXT NOT NULL,
    "candidateTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "candidateMetadata" JSONB,
    "candidateBoardId" UUID NOT NULL,
    "candidateKind" "PostKind" NOT NULL,
    "candidateAttachmentIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "isNewPost" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" VARCHAR(32) NOT NULL DEFAULT 'v1',
    "model" VARCHAR(80) NOT NULL DEFAULT 'gpt-5.6-luna',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMPTZ(6),
    "leaseExpiresAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewerReason" VARCHAR(1000),
    CONSTRAINT "ModerationSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModerationAttempt" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionId" UUID NOT NULL,
    "layer" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "latencyMs" INTEGER,
    "providerRunId" VARCHAR(160),
    "tokenUsage" JSONB,
    "result" JSONB,
    "sanitizedError" VARCHAR(1000),
    CONSTRAINT "ModerationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModerationRule" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "kind" "ModerationRuleKind" NOT NULL,
    "pattern" VARCHAR(500) NOT NULL,
    "normalized" VARCHAR(500) NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 50,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(1000),
    "policyVersion" VARCHAR(32) NOT NULL DEFAULT 'v1',
    "createdById" UUID NOT NULL,
    CONSTRAINT "ModerationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModerationSubmission_state_createdAt_idx" ON "ModerationSubmission"("state", "createdAt");
CREATE INDEX "ModerationSubmission_postId_createdAt_idx" ON "ModerationSubmission"("postId", "createdAt" DESC);
CREATE INDEX "ModerationSubmission_authorId_createdAt_idx" ON "ModerationSubmission"("authorId", "createdAt" DESC);
CREATE INDEX "ModerationSubmission_inputHash_idx" ON "ModerationSubmission"("inputHash");
CREATE INDEX "ModerationSubmission_leaseExpiresAt_idx" ON "ModerationSubmission"("leaseExpiresAt");
CREATE INDEX "ModerationAttempt_submissionId_createdAt_idx" ON "ModerationAttempt"("submissionId", "createdAt");
CREATE INDEX "ModerationAttempt_status_createdAt_idx" ON "ModerationAttempt"("status", "createdAt");
CREATE INDEX "ModerationRule_enabled_kind_idx" ON "ModerationRule"("enabled", "kind");
CREATE INDEX "ModerationRule_createdById_createdAt_idx" ON "ModerationRule"("createdById", "createdAt" DESC);
CREATE UNIQUE INDEX "ModerationRule_kind_normalized_policyVersion_key" ON "ModerationRule"("kind", "normalized", "policyVersion");

ALTER TABLE "ModerationSubmission" ADD CONSTRAINT "ModerationSubmission_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationSubmission" ADD CONSTRAINT "ModerationSubmission_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModerationSubmission" ADD CONSTRAINT "ModerationSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationAttempt" ADD CONSTRAINT "ModerationAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ModerationSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationRule" ADD CONSTRAINT "ModerationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

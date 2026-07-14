-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('REGISTER', 'RESET', 'REVERIFY');

-- Verification tickets predate the invite flow. Convert their bounded string
-- purpose to the shared enum before creating the invite table.
ALTER TABLE "VerificationTicket" ALTER COLUMN "purpose" DROP DEFAULT;
ALTER TABLE "VerificationTicket"
  ALTER COLUMN "purpose" TYPE "VerificationPurpose"
  USING ("purpose"::"VerificationPurpose");
ALTER TABLE "VerificationTicket" ALTER COLUMN "purpose" SET DEFAULT 'REGISTER';

-- AddColumn
ALTER TABLE "VerificationTicket" ADD COLUMN "studentInviteId" UUID;

-- CreateTable
CREATE TABLE "StudentInvite" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "claimedAt" TIMESTAMPTZ(6),
    "usedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "purpose" "VerificationPurpose" NOT NULL DEFAULT 'REGISTER',
    "codeHash" CHAR(64) NOT NULL,
    "activeKey" VARCHAR(32),
    "encryptedName" TEXT NOT NULL,
    "nameFingerprint" CHAR(64) NOT NULL,
    "identityFingerprint" CHAR(64) NOT NULL,
    "studentCode" CHAR(6) NOT NULL,
    "currentStudentNumber" CHAR(4) NOT NULL,
    "generation" INTEGER NOT NULL,
    "grade" INTEGER NOT NULL,
    "classNumber" INTEGER NOT NULL,
    "studentNumber" INTEGER NOT NULL,
    "schoolYear" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "usedById" UUID,
    "revokedById" UUID,
    "revokedReason" VARCHAR(1000),

    CONSTRAINT "StudentInvite_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudentInvite_state_check" CHECK (NOT ("usedAt" IS NOT NULL AND "revokedAt" IS NOT NULL)),
    CONSTRAINT "StudentInvite_use_requires_claim_check" CHECK ("usedAt" IS NULL OR "claimedAt" IS NOT NULL),
    CONSTRAINT "StudentInvite_student_code_check" CHECK ("studentCode" ~ '^[0-9]{6}$'),
    CONSTRAINT "StudentInvite_current_number_check" CHECK ("currentStudentNumber" ~ '^[1-3][1-9][0-9]{2}$'),
    CONSTRAINT "StudentInvite_generation_check" CHECK ("generation" BETWEEN 1 AND 99),
    CONSTRAINT "StudentInvite_grade_check" CHECK ("grade" BETWEEN 1 AND 3),
    CONSTRAINT "StudentInvite_class_check" CHECK ("classNumber" BETWEEN 1 AND 9),
    CONSTRAINT "StudentInvite_number_check" CHECK ("studentNumber" BETWEEN 1 AND 40),
    CONSTRAINT "StudentInvite_school_year_check" CHECK ("schoolYear" BETWEEN 2000 AND 2200)
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentInvite_codeHash_key" ON "StudentInvite"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "StudentInvite_activeKey_key" ON "StudentInvite"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationTicket_studentInviteId_key" ON "VerificationTicket"("studentInviteId");

-- CreateIndex
CREATE INDEX "StudentInvite_purpose_studentCode_createdAt_idx" ON "StudentInvite"("purpose", "studentCode", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "StudentInvite_expiresAt_claimedAt_usedAt_revokedAt_idx" ON "StudentInvite"("expiresAt", "claimedAt", "usedAt", "revokedAt");

-- CreateIndex
CREATE INDEX "StudentInvite_createdById_createdAt_idx" ON "StudentInvite"("createdById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "StudentInvite_usedById_idx" ON "StudentInvite"("usedById");

-- CreateIndex
CREATE INDEX "StudentInvite_revokedById_idx" ON "StudentInvite"("revokedById");

-- AddForeignKey
ALTER TABLE "StudentInvite" ADD CONSTRAINT "StudentInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentInvite" ADD CONSTRAINT "StudentInvite_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentInvite" ADD CONSTRAINT "StudentInvite_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationTicket" ADD CONSTRAINT "VerificationTicket_studentInviteId_fkey" FOREIGN KEY ("studentInviteId") REFERENCES "StudentInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum: attendance rewards and shop purchases join the IGK ledger.
-- PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE inside a transaction as long
-- as the new value is not used before commit; this migration never uses them.
ALTER TYPE "IgkTransactionType" ADD VALUE 'ATTENDANCE_REWARD';
ALTER TYPE "IgkTransactionType" ADD VALUE 'SHOP_PURCHASE';

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "attendanceStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bestAttendanceStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAttendanceDate" DATE;

-- CreateTable
CREATE TABLE "UserItem" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "userId" UUID NOT NULL,
    "itemId" VARCHAR(60) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "equipped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserItem_userId_itemId_key" ON "UserItem"("userId", "itemId");

-- CreateIndex
CREATE INDEX "UserItem_userId_idx" ON "UserItem"("userId");

-- AddForeignKey
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

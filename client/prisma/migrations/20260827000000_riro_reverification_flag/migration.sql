ALTER TABLE "User"
  ADD COLUMN "requiresRiroReverification" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "requiresRiroReverification" = true
WHERE "role" = 'USER';

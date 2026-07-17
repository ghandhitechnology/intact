-- Keep the legacy lifetime threshold during the compatibility window, while
-- making current spendable IGK the canonical source for user tiers.
ALTER TABLE "LevelRule" ADD COLUMN "minimumCurrentIgk" INTEGER;

UPDATE "LevelRule"
SET "minimumCurrentIgk" = "minimumLifetimeIgk";

ALTER TABLE "LevelRule" ALTER COLUMN "minimumCurrentIgk" SET NOT NULL;
CREATE UNIQUE INDEX "LevelRule_minimumCurrentIgk_key"
  ON "LevelRule"("minimumCurrentIgk");

INSERT INTO "LevelRule" (
  "level", "minimumLifetimeIgk", "minimumCurrentIgk", "label", "updatedAt"
) VALUES (11, 25000, 25000, '조졸', CURRENT_TIMESTAMP)
ON CONFLICT ("level") DO UPDATE SET
  "minimumCurrentIgk" = EXCLUDED."minimumCurrentIgk",
  "minimumLifetimeIgk" = EXCLUDED."minimumLifetimeIgk",
  "label" = EXCLUDED."label";

ALTER TABLE "User"
  ADD COLUMN "profileImageAttachmentId" UUID,
  ADD COLUMN "showRealName" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "showStudentCode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "showActivityStats" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_profileImageAttachmentId_key"
  ON "User"("profileImageAttachmentId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_profileImageAttachmentId_fkey"
  FOREIGN KEY ("profileImageAttachmentId") REFERENCES "Attachment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The denormalized level is guarded in PostgreSQL so every currentIgk writer,
-- including future jobs and administration tools, gets the invariant for free.
CREATE OR REPLACE FUNCTION "sync_user_level_from_current_igk"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  computed_level INTEGER;
BEGIN
  SELECT rules."level"
    INTO computed_level
    FROM "LevelRule" AS rules
   WHERE rules."minimumCurrentIgk" <= NEW."currentIgk"
   ORDER BY rules."minimumCurrentIgk" DESC
   LIMIT 1;

  NEW."level" := COALESCE(computed_level, 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "User_sync_level_from_current_igk" ON "User";
CREATE TRIGGER "User_sync_level_from_current_igk"
BEFORE INSERT OR UPDATE OF "currentIgk" ON "User"
FOR EACH ROW
EXECUTE FUNCTION "sync_user_level_from_current_igk"();

UPDATE "User" AS users
SET "level" = COALESCE((
  SELECT rules."level"
  FROM "LevelRule" AS rules
  WHERE rules."minimumCurrentIgk" <= users."currentIgk"
  ORDER BY rules."minimumCurrentIgk" DESC
  LIMIT 1
), 1);

CREATE INDEX "User_active_currentIgk_ranking_idx"
  ON "User"("status", "currentIgk" DESC, "createdAt", "id");

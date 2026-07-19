-- Received gifts now contribute to lifetime IGK. Backfill every historical
-- TRANSFER_RECEIVED entry exactly once as part of this migration.
WITH received_gifts AS (
  SELECT "userId", COALESCE(SUM(amount), 0)::INTEGER AS total
  FROM "IgkLedger"
  WHERE type = 'TRANSFER_RECEIVED' AND amount > 0
  GROUP BY "userId"
)
UPDATE "User" AS users
SET "lifetimeIgk" = users."lifetimeIgk" + received_gifts.total
FROM received_gifts
WHERE users.id = received_gifts."userId";

UPDATE "LevelRule"
SET label = CASE level
  WHEN 1 THEN '9등급'
  WHEN 2 THEN '8등급'
  WHEN 3 THEN '7등급'
  WHEN 4 THEN '6등급'
  WHEN 5 THEN '5등급'
  WHEN 6 THEN '4등급'
  WHEN 7 THEN '3등급'
  WHEN 8 THEN '2등급'
  WHEN 9 THEN '1등급'
  WHEN 10 THEN '선생님'
  ELSE label
END,
"updatedAt" = CURRENT_TIMESTAMP
WHERE level BETWEEN 1 AND 10;

UPDATE "User" AS users
SET level = COALESCE((
  SELECT rules.level
  FROM "LevelRule" AS rules
  WHERE rules."minimumLifetimeIgk" <= users."lifetimeIgk"
  ORDER BY rules."minimumLifetimeIgk" DESC
  LIMIT 1
), 1);

CREATE INDEX "User_currentIgk_idx" ON "User"("currentIgk" DESC);

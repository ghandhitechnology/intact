-- Administrative IGK adjustments historically changed only the spendable
-- balance. Apply their net effect to lifetime IGK so grants and corrections
-- participate in the same leveling rules as all other credited IGK.
WITH admin_adjustments AS (
  SELECT "userId", COALESCE(SUM(amount), 0)::INTEGER AS total
  FROM "IgkLedger"
  WHERE type = 'ADMIN_ADJUSTMENT'
  GROUP BY "userId"
)
UPDATE "User" AS users
SET "lifetimeIgk" = GREATEST(0, users."lifetimeIgk" + admin_adjustments.total)
FROM admin_adjustments
WHERE users.id = admin_adjustments."userId"
  AND admin_adjustments.total <> 0;

-- Rebuild the denormalized level for every account. This also repairs any
-- stale value left by an interrupted reward, transfer, or prior adjustment.
UPDATE "User" AS users
SET level = COALESCE((
  SELECT rules.level
  FROM "LevelRule" AS rules
  WHERE rules."minimumLifetimeIgk" <= users."lifetimeIgk"
  ORDER BY rules."minimumLifetimeIgk" DESC
  LIMIT 1
), 1);

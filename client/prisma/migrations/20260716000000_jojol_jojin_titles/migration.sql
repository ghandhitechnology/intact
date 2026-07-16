-- Rename final IGK level label from 선생님 to 조진
UPDATE "LevelRule"
SET "label" = '조진'
WHERE "level" = 10;

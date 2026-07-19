CREATE TABLE "PlatformSetting" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'global',
    "bSideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bSideEpoch" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSetting" ("id", "bSideEnabled", "bSideEpoch", "updatedAt")
VALUES ('global', false, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

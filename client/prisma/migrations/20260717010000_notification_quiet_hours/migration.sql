CREATE TABLE "NotificationSetting" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "userId" UUID NOT NULL,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" CHAR(5) NOT NULL DEFAULT '22:00',
    "quietHoursEnd" CHAR(5) NOT NULL DEFAULT '07:00',
    "timeZone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Seoul',
    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationSetting_quiet_hours_start_check"
        CHECK ("quietHoursStart" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "NotificationSetting_quiet_hours_end_check"
        CHECK ("quietHoursEnd" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "NotificationSetting_time_zone_nonempty_check"
        CHECK (length(btrim("timeZone")) > 0)
);

CREATE UNIQUE INDEX "NotificationSetting_userId_key"
    ON "NotificationSetting"("userId");

ALTER TABLE "NotificationSetting"
    ADD CONSTRAINT "NotificationSetting_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

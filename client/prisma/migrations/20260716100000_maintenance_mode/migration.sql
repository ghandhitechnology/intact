-- AlterTable: global maintenance-mode switch on the platform settings row.
ALTER TABLE "PlatformSetting"
ADD COLUMN "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT false;

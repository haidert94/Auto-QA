BEGIN;

ALTER TABLE "TestRun" ADD COLUMN "targetBrowser" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "targetDevice" TEXT;

COMMIT;

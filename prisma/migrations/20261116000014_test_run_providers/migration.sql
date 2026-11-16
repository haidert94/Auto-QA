BEGIN;

ALTER TABLE "TestRun" ADD COLUMN "targetProvider" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "providerSessionUrl" TEXT;

COMMIT;

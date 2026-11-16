BEGIN;

ALTER TABLE "TestRun" ADD COLUMN "scenarioId" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "environmentId" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "runKey" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "createdByUserId" TEXT;

CREATE UNIQUE INDEX "TestRun_runKey_key" ON "TestRun"("runKey");
CREATE INDEX "TestRun_projectId_status_createdAt_idx" ON "TestRun"("projectId", "status", "createdAt");

ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_scenarioId_fkey"
  FOREIGN KEY ("scenarioId") REFERENCES "TestScenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

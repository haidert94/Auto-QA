BEGIN;

ALTER TABLE "TestRun" ADD COLUMN "specText" TEXT;

CREATE INDEX "TestRun_projectId_scenarioId_createdAt_idx"
  ON "TestRun"("projectId", "scenarioId", "createdAt");

CREATE INDEX "Exploration_projectId_environmentId_startUrl_finishedAt_idx"
  ON "Exploration"("projectId", "environmentId", "startUrl", "finishedAt");

COMMIT;

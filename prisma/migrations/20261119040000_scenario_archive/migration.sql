ALTER TABLE "TestScenario" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "TestScenario_projectId_archivedAt_idx" ON "TestScenario"("projectId", "archivedAt");

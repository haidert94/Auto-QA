ALTER TABLE "Requirement" ADD COLUMN "module" TEXT;
ALTER TABLE "TestScenario" ADD COLUMN "caseCode" TEXT;
ALTER TABLE "Monitor" ADD COLUMN "caseCode" TEXT;
ALTER TABLE "PerformanceAudit" ADD COLUMN "caseCode" TEXT;
ALTER TABLE "LoadTest" ADD COLUMN "caseCode" TEXT;
ALTER TABLE "UxAudit" ADD COLUMN "caseCode" TEXT;

CREATE TABLE "ScenarioModuleSequence" (
    "projectId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastOrdinal" INTEGER NOT NULL,
    CONSTRAINT "ScenarioModuleSequence_pkey" PRIMARY KEY ("projectId", "prefix")
);

ALTER TABLE "ScenarioModuleSequence" ADD CONSTRAINT "ScenarioModuleSequence_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

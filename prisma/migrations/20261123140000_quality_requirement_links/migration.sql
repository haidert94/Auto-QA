ALTER TABLE "Monitor" ADD COLUMN "requirementId" TEXT;
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PerformanceAudit" ADD COLUMN "requirementId" TEXT;
ALTER TABLE "PerformanceAudit" ADD CONSTRAINT "PerformanceAudit_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoadTest" ADD COLUMN "requirementId" TEXT;
ALTER TABLE "LoadTest" ADD CONSTRAINT "LoadTest_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UxAudit" ADD COLUMN "requirementId" TEXT;
ALTER TABLE "UxAudit" ADD CONSTRAINT "UxAudit_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

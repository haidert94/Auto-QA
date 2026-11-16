BEGIN;

CREATE TABLE "PerformanceAudit" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "environmentId" TEXT,
  "url" TEXT NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "runKey" TEXT,
  "createdByUserId" TEXT,
  "performanceScore" INTEGER,
  "accessibilityScore" INTEGER,
  "bestPracticesScore" INTEGER,
  "seoScore" INTEGER,
  "fcpMs" INTEGER,
  "lcpMs" INTEGER,
  "tbtMs" INTEGER,
  "cls" DOUBLE PRECISION,
  "siMs" INTEGER,
  "reportKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PerformanceAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerformanceAudit_runKey_key" ON "PerformanceAudit"("runKey");
CREATE INDEX "PerformanceAudit_projectId_createdAt_idx" ON "PerformanceAudit"("projectId", "createdAt");

ALTER TABLE "PerformanceAudit" ADD CONSTRAINT "PerformanceAudit_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerformanceAudit" ADD CONSTRAINT "PerformanceAudit_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PerformanceAudit" ADD CONSTRAINT "PerformanceAudit_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

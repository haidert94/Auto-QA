BEGIN;

ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'UX_ANALYSIS';

CREATE TABLE "UxAudit" (
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
  "totalFindings" INTEGER,
  "criticalCount" INTEGER,
  "majorCount" INTEGER,
  "minorCount" INTEGER,
  "reportKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UxAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UxAudit_runKey_key" ON "UxAudit"("runKey");
CREATE INDEX "UxAudit_projectId_createdAt_idx" ON "UxAudit"("projectId", "createdAt");

ALTER TABLE "UxAudit" ADD CONSTRAINT "UxAudit_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UxAudit" ADD CONSTRAINT "UxAudit_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UxAudit" ADD CONSTRAINT "UxAudit_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

BEGIN;

CREATE TABLE "Monitor" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "environmentId" TEXT,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
  "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notifyEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdByUserId" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastLatencyMs" INTEGER,
  "lastHttpStatus" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Monitor_projectId_idx" ON "Monitor"("projectId");
CREATE INDEX "Monitor_active_lastCheckedAt_idx" ON "Monitor"("active", "lastCheckedAt");

ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MonitorCheck" (
  "id" TEXT NOT NULL,
  "monitorId" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL,
  "httpStatus" INTEGER,
  "latencyMs" INTEGER,
  "errorCode" TEXT,
  CONSTRAINT "MonitorCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MonitorCheck_monitorId_at_idx" ON "MonitorCheck"("monitorId", "at");

ALTER TABLE "MonitorCheck" ADD CONSTRAINT "MonitorCheck_monitorId_fkey"
  FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

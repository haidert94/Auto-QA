BEGIN;

CREATE TABLE "LoadTest" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "environmentId" TEXT,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "stages" JSONB NOT NULL,
  "thresholds" JSONB,
  "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "runKey" TEXT,
  "createdByUserId" TEXT,
  "totalRequests" INTEGER,
  "reqPerSec" DOUBLE PRECISION,
  "failRate" DOUBLE PRECISION,
  "p50Ms" INTEGER,
  "p95Ms" INTEGER,
  "p99Ms" INTEGER,
  "maxVus" INTEGER,
  "durationSec" INTEGER,
  "summaryKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoadTest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoadTest_runKey_key" ON "LoadTest"("runKey");
CREATE INDEX "LoadTest_projectId_createdAt_idx" ON "LoadTest"("projectId", "createdAt");

ALTER TABLE "LoadTest" ADD CONSTRAINT "LoadTest_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadTest" ADD CONSTRAINT "LoadTest_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoadTest" ADD CONSTRAINT "LoadTest_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

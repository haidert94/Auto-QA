BEGIN;

ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'LIGHTHOUSE_AUDITS';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'LOAD_TESTS';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'UPTIME_MONITORS';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'CROSS_BROWSER';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'DEVICE_CLOUD';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'AI_DOCUMENT_ANALYSIS';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'AI_SCENARIO_GENERATION';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'AI_FAILURE_EXPLANATION';

CREATE TABLE "MeteredAi" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "operation" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "costCop" INTEGER NOT NULL,
  "runKey" TEXT,
  "month" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeteredAi_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MeteredAi_organizationId_month_idx" ON "MeteredAi"("organizationId", "month");
CREATE INDEX "MeteredAi_organizationId_operation_createdAt_idx" ON "MeteredAi"("organizationId", "operation", "createdAt");
ALTER TABLE "MeteredAi" ADD CONSTRAINT "MeteredAi_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrgBudget" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "aiTokensUsed" INTEGER NOT NULL DEFAULT 0,
  "aiCostCop" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrgBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgBudget_organizationId_monthKey_key" ON "OrgBudget"("organizationId", "monthKey");
ALTER TABLE "OrgBudget" ADD CONSTRAINT "OrgBudget_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

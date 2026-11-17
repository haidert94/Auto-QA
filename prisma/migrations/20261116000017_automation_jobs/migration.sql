BEGIN;

CREATE TABLE "AutomationJob" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
  "stage" TEXT NOT NULL DEFAULT 'pending',
  "inputs" JSONB NOT NULL,
  "steps" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result" JSONB,
  "errorCode" TEXT,
  "runKey" TEXT,
  "createdByUserId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationJob_runKey_key" ON "AutomationJob"("runKey");
CREATE INDEX "AutomationJob_projectId_createdAt_idx" ON "AutomationJob"("projectId", "createdAt");
CREATE INDEX "AutomationJob_status_createdAt_idx" ON "AutomationJob"("status", "createdAt");

ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Essentials recibe IA: activa AI_DOCUMENT_ANALYSIS con 500k tokens/mes
-- usando Haiku. Las operaciones que requieren Sonnet (SCENARIO_GENERATION,
-- FAILURE_EXPLANATION) permanecen NOT_INCLUDED en Essentials.
UPDATE "PlanCapability"
SET availability = 'OPERATIONAL',
    label = 'Análisis IA de docs',
    detail = '500k tokens/mes (Haiku)',
    "monthlyLimit" = 500000
WHERE "planCode" = 'essentials' AND code = 'AI_DOCUMENT_ANALYSIS';

COMMIT;

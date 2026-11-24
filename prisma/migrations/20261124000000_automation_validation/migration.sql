CREATE TABLE "AutomationValidation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "environmentType" "EnvironmentType" NOT NULL,
  "scopeSignature" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "workflowRunId" TEXT,
  "version" TEXT NOT NULL,
  "cases" JSONB NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AutomationValidation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationValidation_projectId_fkey" FOREIGN KEY ("projectId")
    REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AutomationValidation_projectId_createdAt_idx"
  ON "AutomationValidation"("projectId", "createdAt");

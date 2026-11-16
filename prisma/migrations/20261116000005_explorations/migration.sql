BEGIN;

-- CreateEnum
CREATE TYPE "ExplorationStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ExplorationLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "Exploration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "startUrl" TEXT NOT NULL,
    "status" "ExplorationStatus" NOT NULL DEFAULT 'QUEUED',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,

    CONSTRAINT "Exploration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExplorationPage" (
    "id" TEXT NOT NULL,
    "explorationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "title" TEXT,
    "screenshotKey" TEXT,
    "domSize" INTEGER,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExplorationPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExplorationLog" (
    "id" TEXT NOT NULL,
    "explorationId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "ExplorationLogLevel" NOT NULL,
    "code" TEXT NOT NULL,
    "detail" TEXT,

    CONSTRAINT "ExplorationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exploration_projectId_status_idx" ON "Exploration"("projectId", "status");
CREATE INDEX "Exploration_status_queuedAt_idx" ON "Exploration"("status", "queuedAt");
CREATE INDEX "ExplorationPage_explorationId_position_idx" ON "ExplorationPage"("explorationId", "position");
CREATE INDEX "ExplorationLog_explorationId_at_idx" ON "ExplorationLog"("explorationId", "at");

-- AddForeignKey
ALTER TABLE "Exploration" ADD CONSTRAINT "Exploration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Exploration" ADD CONSTRAINT "Exploration_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExplorationPage" ADD CONSTRAINT "ExplorationPage_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExplorationLog" ADD CONSTRAINT "ExplorationLog_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

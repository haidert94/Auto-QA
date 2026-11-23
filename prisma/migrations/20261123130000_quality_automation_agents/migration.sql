ALTER TABLE "Monitor" ADD COLUMN "automationCode" TEXT, ADD COLUMN "automationReview" TEXT;
ALTER TABLE "PerformanceAudit" ADD COLUMN "automationCode" TEXT, ADD COLUMN "automationReview" TEXT;
ALTER TABLE "LoadTest" ADD COLUMN "automationCode" TEXT, ADD COLUMN "automationReview" TEXT;
ALTER TABLE "UxAudit" ADD COLUMN "automationCode" TEXT, ADD COLUMN "automationReview" TEXT;

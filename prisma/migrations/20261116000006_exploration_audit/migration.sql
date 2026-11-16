BEGIN;

ALTER TABLE "Exploration" ADD COLUMN "runKey" TEXT;
ALTER TABLE "Exploration" ADD COLUMN "createdByUserId" TEXT;

CREATE UNIQUE INDEX "Exploration_runKey_key" ON "Exploration"("runKey");

ALTER TABLE "Exploration" ADD CONSTRAINT "Exploration_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

BEGIN;

-- CreateEnum
CREATE TYPE "AccessMode" AS ENUM ('PUBLIC', 'PRIVATE', 'SSO');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "executionSettings" JSONB,
ADD COLUMN     "ownerLabel" TEXT,
ADD COLUMN     "priorityModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Environment" ADD COLUMN     "accessMode" "AccessMode",
ADD COLUMN     "allowedPaths" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "authorizationConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "authorizedAt" TIMESTAMP(3),
ADD COLUMN     "excludedPaths" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "prohibitedActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "testData" JSONB,
ALTER COLUMN "type" DROP NOT NULL,
ALTER COLUMN "baseUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TestRole" ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '[]';

-- The starter collected authorization only for the single environment it created.
UPDATE "Environment" AS environment
SET "authorizationConfirmed" = true, "authorizedAt" = project."authorizedAt"
FROM "Project" AS project
WHERE environment."projectId" = project."id"
  AND project."authorizationConfirmed" = true
  AND project."authorizedAt" IS NOT NULL
  AND (SELECT count(*) FROM "Environment" WHERE "projectId" = project."id") = 1;

-- Previous records need an explicit scope and access mode before they can be ready.
UPDATE "Project" SET "status" = 'DRAFT' WHERE "status" = 'READY';

COMMIT;

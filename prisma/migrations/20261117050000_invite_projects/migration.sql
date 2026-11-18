ALTER TABLE "OrganizationInvite"
  ADD COLUMN "projectIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

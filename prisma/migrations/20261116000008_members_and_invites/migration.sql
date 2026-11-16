BEGIN;

CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

ALTER TABLE "OrganizationMember" ADD COLUMN "role" "OrgRole" NOT NULL DEFAULT 'VIEWER';
ALTER TABLE "OrganizationMember" ADD COLUMN "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Los miembros existentes son dueños de su organización (registraron la cuenta).
UPDATE "OrganizationMember" SET "role" = 'OWNER';

CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");

CREATE TABLE "OrganizationInvite" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "OrgRole" NOT NULL,
  "digest" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizationInvite_digest_key" ON "OrganizationInvite"("digest");
CREATE UNIQUE INDEX "OrganizationInvite_organizationId_email_key" ON "OrganizationInvite"("organizationId", "email");
CREATE INDEX "OrganizationInvite_organizationId_idx" ON "OrganizationInvite"("organizationId");
ALTER TABLE "OrganizationInvite" ADD CONSTRAINT "OrganizationInvite_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvite" ADD CONSTRAINT "OrganizationInvite_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AccessAudit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "targetKind" TEXT,
  "targetId" TEXT,
  "ip" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessAudit_organizationId_at_idx" ON "AccessAudit"("organizationId", "at");
ALTER TABLE "AccessAudit" ADD CONSTRAINT "AccessAudit_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessAudit" ADD CONSTRAINT "AccessAudit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

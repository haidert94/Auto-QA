-- Fix: hasta el commit anterior, el registro creaba la OrganizationMember
-- sin especificar role, cayendo al default VIEWER del schema. Resultado:
-- quien creó su organización no podía invitar ni cambiar roles. Promovemos
-- a OWNER a cualquier miembro ÚNICO de su org que hoy esté como VIEWER.
-- Si alguien se registró y luego invitó a otros estando como VIEWER, esta
-- migración NO los toca: su org ya quedó compartida y transferir OWNER
-- debe hacerlo el humano explícitamente.
UPDATE "OrganizationMember" om
SET role = 'OWNER'
WHERE om.role = 'VIEWER'
  AND NOT EXISTS (
    SELECT 1
    FROM "OrganizationMember" peer
    WHERE peer."organizationId" = om."organizationId"
      AND peer."userId" <> om."userId"
  );

-- Defensive rename: if the same organization already has two or more projects
-- whose names collide (case-insensitive), keep the oldest as-is and append
-- " (2)", " (3)", ... to the newer ones so the unique index can be created
-- without manual cleanup. The service-level check is also case-insensitive.
WITH ranked AS (
  SELECT id,
         name,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'), LOWER(name)
           ORDER BY "createdAt" ASC, id ASC
         ) AS position
  FROM "Project"
)
UPDATE "Project" p
SET name = p.name || ' (' || r.position || ')'
FROM ranked r
WHERE p.id = r.id AND r.position > 1;

-- Enforce exact-match uniqueness per organization at the DB level. The service
-- layer additionally normalizes case before checking, so "Prueba" and "prueba"
-- are rejected in practice; this index is the race-condition safety net.
CREATE UNIQUE INDEX "Project_organizationId_name_key"
  ON "Project" ("organizationId", "name");

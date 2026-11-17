-- Añade la capability UX_ANALYSIS a los 4 planes activos con los
-- límites acordados. Idempotente via ON CONFLICT.

BEGIN;

INSERT INTO "PlanCapability" ("planCode", code, availability, label, detail, position, browsers, "monthlyLimit", "monitorLimit", "minIntervalMinutes", "maxVirtualUsers", "maxDurationMinutes") VALUES
  ('essentials',   'UX_ANALYSIS', 'NOT_INCLUDED', 'Análisis UX con IA',       'Upgrade a Professional',         20, ARRAY[]::TEXT[], 0,   NULL, NULL, NULL, NULL),
  ('professional', 'UX_ANALYSIS', 'OPERATIONAL',  'Análisis UX con IA',       '20 auditorías/mes (Sonnet)',     20, ARRAY[]::TEXT[], 20,  NULL, NULL, NULL, NULL),
  ('business',     'UX_ANALYSIS', 'OPERATIONAL',  'Análisis UX con IA',       '100 auditorías/mes',             20, ARRAY[]::TEXT[], 100, NULL, NULL, NULL, NULL),
  ('enterprise',   'UX_ANALYSIS', 'OPERATIONAL',  'Análisis UX con IA',       'Ilimitado (Sonnet o BYOK)',      20, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL)
ON CONFLICT ("planCode", code) DO UPDATE SET
  availability = EXCLUDED.availability,
  label = EXCLUDED.label,
  detail = EXCLUDED.detail,
  "monthlyLimit" = EXCLUDED."monthlyLimit";

COMMIT;

-- Seed de los 4 planes comerciales con las capabilities y límites
-- acordados en docs/AI.md y la tabla comercial. Es idempotente: ON
-- CONFLICT DO UPDATE reemplaza los valores si ya existen. Los planes
-- antiguos quedan como enabled=false para no romper suscripciones
-- vigentes.

BEGIN;

-- Marca los planes previos como deshabilitados sin borrarlos (las
-- suscripciones existentes deben migrarse manualmente).
UPDATE "Plan" SET enabled = false
  WHERE code NOT IN ('essentials', 'professional', 'business', 'enterprise');

INSERT INTO "Plan" (code, name, "priceCop", "maxProjects", "maxRoles", frequency, "parallelRuns", "historyDays", position, enabled)
VALUES
  ('essentials',   'Essentials',   210000,   1,  2,  'MONTHLY', 1, 30,  1, true),
  ('professional', 'Professional', 630000,   3,  5,  'MONTHLY', 2, 90,  2, true),
  ('business',     'Business',     1900000,  10, 15, 'MONTHLY', 4, 365, 3, true),
  ('enterprise',   'Enterprise',   0,        999, 999,'MONTHLY', 8, 1095, 4, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  "priceCop" = EXCLUDED."priceCop",
  "maxProjects" = EXCLUDED."maxProjects",
  "maxRoles" = EXCLUDED."maxRoles",
  frequency = EXCLUDED.frequency,
  "parallelRuns" = EXCLUDED."parallelRuns",
  "historyDays" = EXCLUDED."historyDays",
  position = EXCLUDED.position,
  enabled = true;

-- Limpia capabilities antiguas de estos planes para redeclararlas desde
-- cero (más simple que un diff selectivo).
DELETE FROM "PlanCapability"
  WHERE "planCode" IN ('essentials', 'professional', 'business', 'enterprise');

-- Helpers: la columna `browsers` es String[]; usamos ARRAY[]::TEXT[].

-- ESSENTIALS
INSERT INTO "PlanCapability" ("planCode", code, availability, label, detail, position, browsers, "monthlyLimit", "monitorLimit", "minIntervalMinutes", "maxVirtualUsers", "maxDurationMinutes") VALUES
  ('essentials', 'BROWSER_TESTS',          'OPERATIONAL', 'Pruebas funcionales web', 'Chromium local, 100 runs/mes', 1, ARRAY['CHROMIUM']::TEXT[], 100, NULL, NULL, NULL, NULL),
  ('essentials', 'RESPONSIVE_TESTS',       'OPERATIONAL', 'Mobile web emulado',     'iPhone/Pixel/iPad en Chromium', 2, ARRAY['CHROMIUM']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('essentials', 'UPTIME_MONITORS',        'OPERATIONAL', 'Disponibilidad HTTP',    '2 monitores · intervalo ≥15 min', 3, ARRAY[]::TEXT[], NULL, 2, 15, NULL, NULL),
  ('essentials', 'DOCUMENT_ANALYSIS',      'OPERATIONAL', 'Análisis documental',    'Reglas sin IA', 4, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('essentials', 'IPA',                    'OPERATIONAL', 'IPA trazable',           'Índice con evidencia', 5, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('essentials', 'ICSP',                   'OPERATIONAL', 'ICSP',                   'Salud del producto', 6, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('essentials', 'ADVANCED_REPORTS',       'OPERATIONAL', 'Reportes exportables',   'JSON + PDF via navegador', 7, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('essentials', 'LIGHTHOUSE_AUDITS',      'NOT_INCLUDED','Performance frontend',   'Upgrade a Professional', 8, ARRAY[]::TEXT[], 0, NULL, NULL, NULL, NULL),
  ('essentials', 'CROSS_BROWSER',          'NOT_INCLUDED','Firefox + WebKit',       'Upgrade a Professional', 9, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('essentials', 'LOAD_TESTS',             'NOT_INCLUDED','Pruebas de carga',       'Upgrade a Business', 10, ARRAY[]::TEXT[], 0, NULL, NULL, NULL, NULL),
  ('essentials', 'DEVICE_CLOUD',           'NOT_INCLUDED','Dispositivos reales',    'Upgrade a Business', 11, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('essentials', 'AI_DOCUMENT_ANALYSIS',   'NOT_INCLUDED','Análisis IA de docs',    'Upgrade a Professional', 12, ARRAY[]::TEXT[], 0, NULL, NULL, NULL, NULL),
  ('essentials', 'AI_SCENARIO_GENERATION', 'NOT_INCLUDED','Generación IA',          'Upgrade a Professional', 13, ARRAY[]::TEXT[], 0, NULL, NULL, NULL, NULL),
  ('essentials', 'AI_FAILURE_EXPLANATION', 'NOT_INCLUDED','Explicación IA fallos',  'Upgrade a Professional', 14, ARRAY[]::TEXT[], 0, NULL, NULL, NULL, NULL);

-- PROFESSIONAL
INSERT INTO "PlanCapability" ("planCode", code, availability, label, detail, position, browsers, "monthlyLimit", "monitorLimit", "minIntervalMinutes", "maxVirtualUsers", "maxDurationMinutes") VALUES
  ('professional', 'BROWSER_TESTS',          'OPERATIONAL', 'Pruebas funcionales web', '500 runs/mes',                 1, ARRAY['CHROMIUM']::TEXT[], 500, NULL, NULL, NULL, NULL),
  ('professional', 'CROSS_BROWSER',          'OPERATIONAL', 'Firefox + WebKit',        'Playwright multi-motor',       2, ARRAY['CHROMIUM','FIREFOX','WEBKIT']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'RESPONSIVE_TESTS',       'OPERATIONAL', 'Mobile web emulado',      'iPhone/Pixel/iPad/Galaxy',     3, ARRAY['CHROMIUM','WEBKIT']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'LIGHTHOUSE_AUDITS',      'OPERATIONAL', 'Performance frontend',    '20 audits/mes',                4, ARRAY['CHROMIUM']::TEXT[], 20, NULL, NULL, NULL, NULL),
  ('professional', 'UPTIME_MONITORS',        'OPERATIONAL', 'Disponibilidad HTTP',     '10 monitores · intervalo ≥5 min', 5, ARRAY[]::TEXT[], NULL, 10, 5, NULL, NULL),
  ('professional', 'DOCUMENT_ANALYSIS',      'OPERATIONAL', 'Análisis documental',     'Reglas + clasificación',       6, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'AI_DOCUMENT_ANALYSIS',   'OPERATIONAL', 'Análisis IA de docs',     '3M tokens/mes (Sonnet)',       7, ARRAY[]::TEXT[], 3000000, NULL, NULL, NULL, NULL),
  ('professional', 'AI_SCENARIO_GENERATION', 'OPERATIONAL', 'Generación IA de casos',  'Sonnet',                       8, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'AI_FAILURE_EXPLANATION', 'OPERATIONAL', 'Explicación IA de fallos','Sonnet',                       9, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'IPA',                    'OPERATIONAL', 'IPA trazable',            'Índice con evidencia',         10, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'ICSP',                   'OPERATIONAL', 'ICSP',                    'Salud del producto',           11, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'TRACEABILITY',           'OPERATIONAL', 'Trazabilidad full',       'Reqs → escenarios → runs',     12, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'ADVANCED_REPORTS',       'OPERATIONAL', 'Reportes exportables',    'JSON + PDF + historial 90d',   13, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('professional', 'LOAD_TESTS',             'NOT_INCLUDED','Pruebas de carga',        'Upgrade a Business',           14, ARRAY[]::TEXT[], 0, NULL, NULL, NULL, NULL),
  ('professional', 'DEVICE_CLOUD',           'NOT_INCLUDED','Dispositivos reales',     'Upgrade a Business',           15, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL);

-- BUSINESS
INSERT INTO "PlanCapability" ("planCode", code, availability, label, detail, position, browsers, "monthlyLimit", "monitorLimit", "minIntervalMinutes", "maxVirtualUsers", "maxDurationMinutes") VALUES
  ('business', 'BROWSER_TESTS',          'OPERATIONAL', 'Pruebas funcionales web', '5.000 runs/mes',                 1, ARRAY['CHROMIUM']::TEXT[], 5000, NULL, NULL, NULL, NULL),
  ('business', 'CROSS_BROWSER',          'OPERATIONAL', 'Firefox + WebKit',        'Playwright multi-motor',          2, ARRAY['CHROMIUM','FIREFOX','WEBKIT']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'RESPONSIVE_TESTS',       'OPERATIONAL', 'Mobile web emulado',      'Toda la lista de devices',        3, ARRAY['CHROMIUM','WEBKIT']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'DEVICE_CLOUD',           'OPERATIONAL', 'Dispositivos reales',     'BrowserStack 300 min/mes',        4, ARRAY['CHROMIUM','WEBKIT']::TEXT[], NULL, NULL, NULL, NULL, 300),
  ('business', 'LIGHTHOUSE_AUDITS',      'OPERATIONAL', 'Performance frontend',    '200 audits/mes',                  5, ARRAY['CHROMIUM']::TEXT[], 200, NULL, NULL, NULL, NULL),
  ('business', 'LOAD_TESTS',             'OPERATIONAL', 'Pruebas de carga',        '20 pruebas/mes · 100 VUs · 10 min', 6, ARRAY[]::TEXT[], 20, NULL, NULL, 100, 10),
  ('business', 'UPTIME_MONITORS',        'OPERATIONAL', 'Disponibilidad HTTP',     '50 monitores · intervalo ≥1 min', 7, ARRAY[]::TEXT[], NULL, 50, 1, NULL, NULL),
  ('business', 'DOCUMENT_ANALYSIS',      'OPERATIONAL', 'Análisis documental',     'Reglas + clasificación',          8, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'AI_DOCUMENT_ANALYSIS',   'OPERATIONAL', 'Análisis IA de docs',     '15M tokens/mes',                  9, ARRAY[]::TEXT[], 15000000, NULL, NULL, NULL, NULL),
  ('business', 'AI_SCENARIO_GENERATION', 'OPERATIONAL', 'Generación IA de casos',  'Sonnet',                          10, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'AI_FAILURE_EXPLANATION', 'OPERATIONAL', 'Explicación IA de fallos','Sonnet',                          11, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'IPA',                    'OPERATIONAL', 'IPA trazable',            'Índice con evidencia',            12, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'ICSP',                   'OPERATIONAL', 'ICSP',                    'Salud del producto',              13, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'TRACEABILITY',           'OPERATIONAL', 'Trazabilidad full',       'Reqs → escenarios → runs',        14, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'ADVANCED_REPORTS',       'OPERATIONAL', 'Reportes exportables',    'Historial 365 días',              15, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'CI_CD',                  'OPERATIONAL', 'Integración CI/CD',       'Webhooks disponibles',            16, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL);

-- ENTERPRISE
INSERT INTO "PlanCapability" ("planCode", code, availability, label, detail, position, browsers, "monthlyLimit", "monitorLimit", "minIntervalMinutes", "maxVirtualUsers", "maxDurationMinutes") VALUES
  ('enterprise', 'BROWSER_TESTS',          'OPERATIONAL', 'Pruebas funcionales web', 'Ilimitado (SLA 99.9%)',        1, ARRAY['CHROMIUM']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'CROSS_BROWSER',          'OPERATIONAL', 'Firefox + WebKit',        'Ilimitado',                    2, ARRAY['CHROMIUM','FIREFOX','WEBKIT']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'RESPONSIVE_TESTS',       'OPERATIONAL', 'Mobile web emulado',      'Ilimitado',                    3, ARRAY['CHROMIUM','WEBKIT']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'DEVICE_CLOUD',           'OPERATIONAL', 'Dispositivos reales',     'Bolsa dedicada a medida',      4, ARRAY['CHROMIUM','WEBKIT']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'LIGHTHOUSE_AUDITS',      'OPERATIONAL', 'Performance frontend',    'Ilimitado',                    5, ARRAY['CHROMIUM']::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'LOAD_TESTS',             'OPERATIONAL', 'Pruebas de carga',        '500 VUs · 30 min · ilimitado', 6, ARRAY[]::TEXT[], NULL, NULL, NULL, 500, 30),
  ('enterprise', 'UPTIME_MONITORS',        'OPERATIONAL', 'Disponibilidad HTTP',     'Ilimitado · intervalo ≥1 min', 7, ARRAY[]::TEXT[], NULL, NULL, 1, NULL, NULL),
  ('enterprise', 'DOCUMENT_ANALYSIS',      'OPERATIONAL', 'Análisis documental',     'Reglas + clasificación',       8, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'AI_DOCUMENT_ANALYSIS',   'OPERATIONAL', 'Análisis IA de docs',     'Ilimitado + BYOK disponible',  9, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'AI_SCENARIO_GENERATION', 'OPERATIONAL', 'Generación IA de casos',  'Sonnet / Opus / BYOK',         10, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'AI_FAILURE_EXPLANATION', 'OPERATIONAL', 'Explicación IA de fallos','Sonnet / Opus / BYOK',         11, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'IPA',                    'OPERATIONAL', 'IPA trazable',            'Índice con evidencia',         12, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'ICSP',                   'OPERATIONAL', 'ICSP',                    'Salud del producto',           13, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'TRACEABILITY',           'OPERATIONAL', 'Trazabilidad full',       'Retención a medida',           14, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'ADVANCED_REPORTS',       'OPERATIONAL', 'Reportes exportables',    'Historial a medida',           15, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('enterprise', 'CI_CD',                  'OPERATIONAL', 'Integración CI/CD',       'Webhooks + SSO + SAML',        16, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL);

COMMIT;

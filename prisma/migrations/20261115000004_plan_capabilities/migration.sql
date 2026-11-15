BEGIN;

-- CreateEnum
CREATE TYPE "CapabilityCode" AS ENUM ('FUNCTIONAL_TESTS', 'API_TESTS', 'BROWSER_TESTS', 'RESPONSIVE_TESTS', 'HTTP_MONITORS', 'FLOW_MONITORS', 'PERFORMANCE_TESTS', 'DOCUMENT_ANALYSIS', 'DOCUMENT_AI', 'IPA', 'ICSP', 'CI_CD', 'ADVANCED_REPORTS', 'TRACEABILITY');

-- CreateEnum
CREATE TYPE "CapabilityAvailability" AS ENUM ('OPERATIONAL', 'BETA', 'UPCOMING', 'NOT_INCLUDED');

-- CreateEnum
CREATE TYPE "MeteredRunKind" AS ENUM ('BROWSER', 'API', 'PERFORMANCE');

-- CreateTable
CREATE TABLE "PlanCapability" (
    "planCode" TEXT NOT NULL,
    "code" "CapabilityCode" NOT NULL,
    "availability" "CapabilityAvailability" NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "position" INTEGER NOT NULL,
    "browsers" TEXT[],
    "monthlyLimit" INTEGER,
    "monitorLimit" INTEGER,
    "minIntervalMinutes" INTEGER,
    "maxVirtualUsers" INTEGER,
    "maxDurationMinutes" INTEGER,

    CONSTRAINT "PlanCapability_pkey" PRIMARY KEY ("planCode","code")
);

-- CreateTable
CREATE TABLE "MeteredRun" (
    "organizationId" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "MeteredRunKind" NOT NULL,
    "requestedBrowser" TEXT,
    "requestedVirtualUsers" INTEGER,
    "requestedDurationMinutes" INTEGER,
    "month" DATE NOT NULL,
    "reservedBrowserSeconds" INTEGER NOT NULL,
    "browserSeconds" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MeteredRun_pkey" PRIMARY KEY ("organizationId","runKey")
);

-- CreateTable
CREATE TABLE "MeteredMonitor" (
    "organizationId" TEXT NOT NULL,
    "monitorKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "MeteredMonitor_pkey" PRIMARY KEY ("organizationId","monitorKey")
);

-- CreateIndex
CREATE INDEX "MeteredRun_organizationId_month_idx" ON "MeteredRun"("organizationId", "month");

-- CreateIndex
CREATE INDEX "MeteredRun_organizationId_completedAt_idx" ON "MeteredRun"("organizationId", "completedAt");

-- CreateIndex
CREATE INDEX "MeteredMonitor_organizationId_disabledAt_idx" ON "MeteredMonitor"("organizationId", "disabledAt");

-- AddForeignKey
ALTER TABLE "PlanCapability" ADD CONSTRAINT "PlanCapability_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeteredRun" ADD CONSTRAINT "MeteredRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeteredMonitor" ADD CONSTRAINT "MeteredMonitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Actualiza el catálogo. Las suscripciones y sus importes cotizados mantienen sus referencias.
UPDATE "Plan"
SET "priceCop" = proposal.price, "maxProjects" = proposal.projects, "maxRoles" = proposal.roles, "parallelRuns" = proposal.parallel
FROM (VALUES
  ('starter', 99000, 1, 2, 1),
  ('pro', 299000, 3, 5, 2),
  ('business', 899000, 10, 10, 4)
) AS proposal(code, price, projects, roles, parallel)
WHERE "Plan"."code" = proposal.code;

INSERT INTO "PlanCapability" (
  "planCode", "code", "availability", "label", "detail", "position", "browsers",
  "monthlyLimit", "monitorLimit", "minIntervalMinutes", "maxVirtualUsers", "maxDurationMinutes"
)
SELECT p."code", c.code::"CapabilityCode", c.availability::"CapabilityAvailability", c.label, c.detail, c.position, c.browsers,
  c.monthly_limit, c.monitor_limit, c.min_interval, c.max_users, c.max_duration
FROM (VALUES
  ('starter', 'FUNCTIONAL_TESTS', 'UPCOMING', 'Pruebas funcionales', 'Básicas', 1, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'API_TESTS', 'UPCOMING', 'Pruebas de API', 'Básicas', 2, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'BROWSER_TESTS', 'UPCOMING', 'Compatibilidad de navegadores', NULL, 3, ARRAY['CHROMIUM']::TEXT[], 300, NULL, NULL, NULL, NULL),
  ('starter', 'RESPONSIVE_TESTS', 'UPCOMING', 'Pruebas responsive', 'Básicas', 4, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'HTTP_MONITORS', 'UPCOMING', 'Monitores HTTP', NULL, 5, ARRAY[]::TEXT[], NULL, 2, 15, NULL, NULL),
  ('starter', 'FLOW_MONITORS', 'NOT_INCLUDED', 'Monitoreo de flujos críticos', NULL, 6, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'PERFORMANCE_TESTS', 'NOT_INCLUDED', 'Pruebas de performance', NULL, 7, ARRAY[]::TEXT[], 0, NULL, NULL, NULL, NULL),
  ('starter', 'DOCUMENT_ANALYSIS', 'OPERATIONAL', 'Análisis documental', 'Basado en reglas', 8, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'DOCUMENT_AI', 'UPCOMING', 'Análisis documental con IA', NULL, 9, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'IPA', 'OPERATIONAL', 'Preparación documental (IPA)', NULL, 10, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'ICSP', 'UPCOMING', 'Calidad de la suite (ICSP)', NULL, 11, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'CI_CD', 'NOT_INCLUDED', 'Integración CI/CD', NULL, 12, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'ADVANCED_REPORTS', 'NOT_INCLUDED', 'Reportes avanzados', NULL, 13, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('starter', 'TRACEABILITY', 'NOT_INCLUDED', 'Trazabilidad de ejecución', NULL, 14, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'FUNCTIONAL_TESTS', 'UPCOMING', 'Pruebas funcionales', 'Completas', 1, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'API_TESTS', 'UPCOMING', 'Pruebas de API', 'Completas', 2, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'BROWSER_TESTS', 'UPCOMING', 'Compatibilidad de navegadores', NULL, 3, ARRAY['CHROMIUM', 'FIREFOX', 'WEBKIT']::TEXT[], 1500, NULL, NULL, NULL, NULL),
  ('pro', 'RESPONSIVE_TESTS', 'UPCOMING', 'Pruebas responsive', 'Básicas', 4, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'HTTP_MONITORS', 'UPCOMING', 'Monitores HTTP', NULL, 5, ARRAY[]::TEXT[], NULL, 5, 5, NULL, NULL),
  ('pro', 'FLOW_MONITORS', 'UPCOMING', 'Monitoreo de flujos críticos', 'Programado', 6, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'PERFORMANCE_TESTS', 'UPCOMING', 'Pruebas de performance', 'Performance ligera', 7, ARRAY[]::TEXT[], 0, NULL, NULL, 10, 5),
  ('pro', 'DOCUMENT_ANALYSIS', 'OPERATIONAL', 'Análisis documental', 'Basado en reglas', 8, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'DOCUMENT_AI', 'UPCOMING', 'Análisis documental con IA', NULL, 9, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'IPA', 'OPERATIONAL', 'Preparación documental (IPA)', NULL, 10, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'ICSP', 'UPCOMING', 'Calidad de la suite (ICSP)', NULL, 11, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'CI_CD', 'UPCOMING', 'Integración CI/CD', 'Incluida en la propuesta', 12, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'ADVANCED_REPORTS', 'UPCOMING', 'Reportes avanzados', 'Incluidos en la propuesta', 13, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('pro', 'TRACEABILITY', 'NOT_INCLUDED', 'Trazabilidad de ejecución', NULL, 14, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'FUNCTIONAL_TESTS', 'UPCOMING', 'Pruebas funcionales', 'Avanzadas', 1, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'API_TESTS', 'UPCOMING', 'Pruebas de API', 'Avanzadas', 2, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'BROWSER_TESTS', 'UPCOMING', 'Compatibilidad de navegadores', 'Compatibilidad ampliada', 3, ARRAY['CHROMIUM', 'FIREFOX', 'WEBKIT']::TEXT[], 5000, NULL, NULL, NULL, NULL),
  ('business', 'RESPONSIVE_TESTS', 'UPCOMING', 'Pruebas responsive', 'Básicas', 4, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'HTTP_MONITORS', 'UPCOMING', 'Monitores HTTP', NULL, 5, ARRAY[]::TEXT[], NULL, 10, 1, NULL, NULL),
  ('business', 'FLOW_MONITORS', 'UPCOMING', 'Monitoreo de flujos críticos', 'Avanzado', 6, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'PERFORMANCE_TESTS', 'UPCOMING', 'Pruebas de performance', 'Carga controlada', 7, ARRAY[]::TEXT[], 0, NULL, NULL, 100, 15),
  ('business', 'DOCUMENT_ANALYSIS', 'OPERATIONAL', 'Análisis documental', 'Basado en reglas', 8, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'DOCUMENT_AI', 'UPCOMING', 'Análisis documental con IA', NULL, 9, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'IPA', 'OPERATIONAL', 'Preparación documental (IPA)', NULL, 10, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'ICSP', 'UPCOMING', 'Calidad de la suite (ICSP)', NULL, 11, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'CI_CD', 'UPCOMING', 'Integración CI/CD', 'Incluida en la propuesta', 12, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'ADVANCED_REPORTS', 'UPCOMING', 'Reportes avanzados', 'Incluidos en la propuesta', 13, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL),
  ('business', 'TRACEABILITY', 'UPCOMING', 'Trazabilidad de ejecución', 'De requisito a evidencia de ejecución', 14, ARRAY[]::TEXT[], NULL, NULL, NULL, NULL, NULL)
) AS c(plan, code, availability, label, detail, position, browsers, monthly_limit, monitor_limit, min_interval, max_users, max_duration)
JOIN "Plan" p ON p."code" = c.plan;

ALTER TABLE "PlanCapability" ADD CONSTRAINT "PlanCapability_nonnegative_limits" CHECK (
  "monthlyLimit" >= 0 AND "monitorLimit" >= 0 AND "minIntervalMinutes" > 0 AND
  "maxVirtualUsers" > 0 AND "maxDurationMinutes" > 0
);

ALTER TABLE "MeteredRun" ADD CONSTRAINT "MeteredRun_valid_usage" CHECK (
  "reservedBrowserSeconds" >= 0 AND ("browserSeconds" IS NULL OR "browserSeconds" >= 0) AND
  ("completedAt" IS NULL) = ("browserSeconds" IS NULL)
);

ALTER TABLE "MeteredMonitor" ADD CONSTRAINT "MeteredMonitor_positive_interval" CHECK ("intervalMinutes" > 0);

COMMIT;

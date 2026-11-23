import type { Prisma, RunStatus } from '@prisma/client';

import { DEFAULT_K6_LIMITS, readLoadStages } from '../load/k6-summary';
import { LIGHTHOUSE_CATEGORIES } from '../performance/lighthouse-report';
import { UX_NAVIGATION_TIMEOUT_MS, UX_VIEWPORT } from '../ux/ux-evidence';
import { qualityAutomationSource, qualityAutomationStatus, type QualityAutomation, type QualityKind as Kind } from './quality-automation';
type StatusTone = 'pending' | 'passed' | 'failed' | 'unknown';
type Status = { label: string; tone: StatusTone };
type Run = { status: RunStatus; startedAt: Date | null; completedAt: Date | null };

export type QualityScenarioOrigin = {
  kind: Kind;
  resourceId: string;
  automation: QualityAutomation;
  executionConfig: {
    environmentId: string | null;
    url: string | null;
    parameters: Array<{ label: string; value: string }>;
  };
  label: string;
  status: Status;
  runAt: string | null;
  durationMs: number | null;
  result: string | null;
  hasResult: boolean;
  href?: string;
};

const kinds = {
  availability: { label: 'Monitor de disponibilidad', tags: ['@disponibilidad'] },
  lighthouse: { label: 'Auditoría Lighthouse', tags: ['@performance', '@lighthouse'] },
  load: { label: 'Prueba de carga', tags: ['@performance', '@carga'] },
  ux: { label: 'Auditoría de usabilidad y accesibilidad', tags: ['@ux'] },
} satisfies Record<Kind, { label: string; tags: string[] }>;

const runStatuses: Record<RunStatus, Status> = {
  QUEUED: { label: 'En cola', tone: 'pending' },
  RUNNING: { label: 'En curso', tone: 'pending' },
  COMPLETED: { label: 'Finalizada', tone: 'unknown' },
  FAILED: { label: 'Falló', tone: 'failed' },
  CANCELED: { label: 'Cancelada', tone: 'unknown' },
};

const requirementFields = { requirementId: true, requirement: { select: { title: true, externalKey: true } } } as const;
const runFields = { ...qualityAutomationSource, ...requirementFields, id: true, status: true, startedAt: true, completedAt: true } as const;

function publicTarget(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin + url.pathname : null;
  } catch {
    return null;
  }
}

function displayTarget(raw: string) {
  const url = publicTarget(raw);
  return url ? '«' + url + '»' : 'la dirección configurada';
}

function executionConfig(
  row: { environmentId: string | null; url: string },
  parameters: QualityScenarioOrigin['executionConfig']['parameters'],
) {
  return { environmentId: row.environmentId, url: publicTarget(row.url), parameters };
}

const lighthouseCategoryLabels = {
  performance: 'Rendimiento',
  accessibility: 'Accesibilidad',
  'best-practices': 'Buenas prácticas',
  seo: 'SEO',
};

function runInfo(run: Run) {
  return {
    status: runStatuses[run.status],
    hasResult: run.status === 'COMPLETED' || run.status === 'FAILED',
    runAt: (run.completedAt ?? run.startedAt)?.toISOString() ?? null,
    durationMs: run.startedAt && run.completedAt ? Math.max(0, run.completedAt.getTime() - run.startedAt.getTime()) : null,
  };
}

function scenario(
  kind: Kind, title: string, target: string, context: string, action: string, expectedResult: string,
  row: { requirementId: string | null; requirement: { title: string; externalKey: string | null } | null },
  origin: Omit<QualityScenarioOrigin, 'label' | 'kind'>,
) {
  return {
    id: kind + ':' + origin.resourceId,
    title,
    tags: kinds[kind].tags,
    requirementId: row.requirementId,
    requirement: row.requirement,
    expectedResult,
    steps: [
      { ordinal: 1, action: 'Dado ' + context + ' para ' + target + '.' },
      { ordinal: 2, action: 'Cuando ' + action + '.' },
      { ordinal: 3, action: 'Entonces ' + expectedResult },
    ],
    quality: { ...origin, kind, label: kinds[kind].label },
  };
}

export async function readQualityScenarios(db: Prisma.TransactionClient, projectId: string) {
  const where = { projectId };
  const [monitors, audits, loads, uxAudits] = await Promise.all([
    db.monitor.findMany({
      where,
      select: {
        ...qualityAutomationSource, ...requirementFields, id: true, name: true, active: true, intervalMinutes: true, timeoutMs: true,
        lastCheckedAt: true, lastStatus: true, lastLatencyMs: true, lastHttpStatus: true,
      },
    }),
    db.performanceAudit.findMany({
      where, select: { ...runFields, performanceScore: true },
    }),
    db.loadTest.findMany({
      where, select: { ...runFields, name: true, stages: true, totalRequests: true, p95Ms: true, failRate: true },
    }),
    db.uxAudit.findMany({
      where, select: { ...runFields, totalFindings: true, criticalCount: true },
    }),
  ]);

  const root = '/projects/' + projectId;
  const rows = [
    ...monitors.map(row => {
      const status: Status = !row.active ? { label: 'En pausa', tone: 'unknown' }
        : row.lastStatus === 'UP' ? { label: 'Disponible', tone: 'passed' }
        : row.lastStatus === 'DOWN' ? { label: 'No disponible', tone: 'failed' }
        : { label: 'Sin comprobaciones', tone: 'unknown' };
      return scenario('availability', row.name, displayTarget(row.url), 'que hay un monitor configurado',
        'AutoQA comprueba la disponibilidad cada ' + row.intervalMinutes + ' min',
        'El servicio responde con un código HTTP entre 200 y 399 dentro de ' + row.timeoutMs + ' ms.', row, {
          resourceId: row.id, automation: qualityAutomationStatus('availability', row),
          executionConfig: executionConfig(row, [
            { label: 'Comprobación', value: 'HTTP GET · códigos 200 a 399' },
            { label: 'Intervalo del monitor', value: row.intervalMinutes + ' min' },
            { label: 'Tiempo máximo de respuesta', value: row.timeoutMs + ' ms' },
            { label: 'Estado del monitor', value: row.active ? 'Activo' : 'En pausa' },
          ]),
          status, hasResult: !!row.lastCheckedAt, runAt: row.lastCheckedAt?.toISOString() ?? null,
          durationMs: row.lastLatencyMs,
          result: row.lastHttpStatus === null ? null : 'Última respuesta HTTP ' + row.lastHttpStatus + '.',
          href: root + '/monitors/' + row.id,
        });
    }),
    ...audits.map(row => {
      const target = displayTarget(row.url);
      return scenario('lighthouse', 'Medir el rendimiento de ' + target, target, 'que se preparó una auditoría Lighthouse',
        'Lighthouse mide la carga de la página',
        'Se registra la puntuación de rendimiento y las métricas de carga disponibles.', row, {
          resourceId: row.id, automation: qualityAutomationStatus('lighthouse', row),
          executionConfig: executionConfig(row, [
            { label: 'Navegador', value: 'Chrome' },
            { label: 'Categorías', value: LIGHTHOUSE_CATEGORIES.map(category => lighthouseCategoryLabels[category]).join(', ') },
          ]),
          ...runInfo(row), href: root + '/performance',
          result: row.performanceScore === null ? null : 'Puntuación de rendimiento ' + row.performanceScore + '/100.',
        });
    }),
    ...loads.map(row => {
      const stages = readLoadStages(row.stages);
      const result = [
        row.totalRequests === null ? null : row.totalRequests + ' solicitudes',
        row.failRate === null ? null : new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 }).format(row.failRate) + ' de errores',
        row.p95Ms === null ? null : row.p95Ms + ' ms de tiempo de respuesta (p95)',
      ].filter(Boolean).join(' · ');
      return scenario('load', row.name, displayTarget(row.url), 'que se preparó una prueba de carga',
        'la prueba aplica el perfil de carga configurado',
        'Se registran la cantidad de solicitudes, los tiempos de respuesta y la proporción de errores.', row, {
          resourceId: row.id, automation: qualityAutomationStatus('load', row),
          executionConfig: executionConfig(row, [
            { label: 'Método', value: 'HTTP GET' },
            ...(stages?.map((stage, index) => ({
              label: 'Etapa ' + (index + 1),
              value: stage.duration + ' · ' + stage.target + ' usuarios virtuales',
            })) ?? [{ label: 'Etapas', value: 'Falta un perfil de carga válido.' }]),
            { label: 'Tiempo de respuesta (p95)', value: 'Menor a ' + DEFAULT_K6_LIMITS.p95Ms + ' ms' },
            { label: 'Tasa de error', value: 'Menor al ' + new Intl.NumberFormat('es-CO', { style: 'percent' }).format(DEFAULT_K6_LIMITS.errorRate) },
          ]),
          ...runInfo(row), href: root + '/load', result: result || null,
        });
    }),
    ...uxAudits.map(row => {
      const target = displayTarget(row.url);
      const result = row.totalFindings === null ? null
        : row.totalFindings + (row.totalFindings === 1 ? ' hallazgo registrado' : ' hallazgos registrados')
          + (row.criticalCount === null ? '.' : ' · ' + row.criticalCount + (row.criticalCount === 1 ? ' crítico.' : ' críticos.'));
      return scenario('ux', 'Revisar usabilidad y accesibilidad de ' + target, target, 'que se preparó una auditoría de experiencia de usuario',
        'se revisa la página según los criterios de usabilidad y accesibilidad de la auditoría',
        'El informe registra los hallazgos detectados y su severidad.', row, {
          resourceId: row.id, automation: qualityAutomationStatus('ux', row),
          executionConfig: executionConfig(row, [
            { label: 'Navegador', value: 'Chromium con Playwright' },
            { label: 'Resolución', value: UX_VIEWPORT.width + ' × ' + UX_VIEWPORT.height + ' px' },
            { label: 'Tiempo máximo de navegación', value: UX_NAVIGATION_TIMEOUT_MS / 1000 + ' s' },
            { label: 'Análisis', value: 'Agente de AutoQA · heurísticas de Nielsen y criterios básicos de WCAG' },
          ]),
          ...runInfo(row), result,
        });
    }),
  ];
  return rows.sort((a, b) => a.title.localeCompare(b.title, 'es') || a.id.localeCompare(b.id));
}

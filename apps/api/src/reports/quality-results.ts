import type { Prisma } from '@prisma/client';

export type QualityResultKind = 'availability' | 'lighthouse' | 'load' | 'ux';
export type QualityResult = {
  id: string;
  kind: QualityResultKind;
  title: string;
  target: string | null;
  recordedAt: string;
  status: 'completed' | 'failed' | 'available' | 'unavailable' | 'unknown';
  metrics: Array<{ label: string; value: string }>;
  error: string | null;
  hasEvidence: boolean;
};

export type AvailabilityCheck = {
  id: string;
  at: string;
  status: string;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
};

export type UxResultDetail = {
  summary: string;
  findings: Array<{ severity: string; summary: string; recommendation: string }>;
  hasScreenshot: boolean;
};

const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });
const percent = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 2 });
const MAX_RESULTS_PER_TYPE = 100;

function publicUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.origin + parsed.pathname : null;
  } catch {
    return null;
  }
}

export function qualityError(code: string | null) {
  if (!code) return null;
  if (code === 'audit-failed') return 'Lighthouse no pudo completar la auditoría.';
  if (code === 'no-stages') return 'Faltan etapas de carga.';
  if (code === 'timeout') return 'Se agotó el tiempo de espera.';
  if (/^k6-exit-\d+$/.test(code)) return 'k6 terminó con un error.';
  return 'La ejecución registró un error.';
}

function metrics(values: Array<[string, number | null, string?]>): QualityResult['metrics'] {
  return values.flatMap(([label, value, unit]) => value === null ? [] : [{
    label, value: unit === '%' ? percent.format(value) : number.format(value) + (unit ?? ''),
  }]);
}

function result(
  row: { id: string; url: string; status: string; createdAt: Date; completedAt: Date | null; errorCode: string | null },
  kind: QualityResultKind, title: string, values: QualityResult['metrics'], hasEvidence: boolean,
): QualityResult {
  return {
    id: row.id, kind, title, target: publicUrl(row.url), recordedAt: (row.completedAt ?? row.createdAt).toISOString(),
    status: row.status === 'FAILED' ? 'failed' : 'completed',
    metrics: values, error: qualityError(row.errorCode), hasEvidence,
  };
}

const finished = ['COMPLETED', 'FAILED'] satisfies Prisma.EnumRunStatusFilter['in'];
const run = { id: true, url: true, status: true, completedAt: true, createdAt: true, errorCode: true } as const;
const newest = [{ completedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }] as const;

export async function readQualityResults(db: Prisma.TransactionClient, projectId: string): Promise<QualityResult[]> {
  const where = { projectId, status: { in: finished } };
  const recent = { where, orderBy: [...newest], take: MAX_RESULTS_PER_TYPE };
  const [monitors, lighthouse, load, ux] = await Promise.all([
    db.monitor.findMany({
      where: { projectId, lastCheckedAt: { not: null } },
      orderBy: [{ lastCheckedAt: 'desc' }, { id: 'asc' }], take: MAX_RESULTS_PER_TYPE,
      select: { id: true, name: true, url: true, lastCheckedAt: true, lastStatus: true, lastHttpStatus: true, lastLatencyMs: true },
    }),
    db.performanceAudit.findMany({
      ...recent,
      select: { ...run, performanceScore: true, accessibilityScore: true, bestPracticesScore: true, seoScore: true,
        fcpMs: true, lcpMs: true, tbtMs: true, cls: true, siMs: true, reportKey: true },
    }),
    db.loadTest.findMany({
      ...recent,
      select: { ...run, name: true, totalRequests: true, reqPerSec: true, failRate: true, p50Ms: true,
        p95Ms: true, p99Ms: true, maxVus: true, durationSec: true, summaryKey: true },
    }),
    db.uxAudit.findMany({
      ...recent,
      select: { ...run, totalFindings: true, criticalCount: true, majorCount: true, minorCount: true, reportKey: true },
    }),
  ]);
  const rows: QualityResult[] = [
    ...monitors.flatMap((row): QualityResult[] => row.lastCheckedAt ? [{
      id: row.id, kind: 'availability', title: row.name, target: publicUrl(row.url),
      recordedAt: row.lastCheckedAt.toISOString(), error: null, hasEvidence: true,
      status: row.lastStatus === 'UP' ? 'available' : row.lastStatus === 'DOWN' ? 'unavailable' : 'unknown',
      metrics: metrics([['Código HTTP', row.lastHttpStatus], ['Latencia', row.lastLatencyMs, ' ms']]),
    }] : []),
    ...lighthouse.map(row => result(row, 'lighthouse', 'Auditoría Lighthouse', metrics([
      ['Rendimiento', row.performanceScore, '/100'], ['Accesibilidad', row.accessibilityScore, '/100'],
      ['Buenas prácticas', row.bestPracticesScore, '/100'], ['SEO', row.seoScore, '/100'],
      ['FCP', row.fcpMs, ' ms'], ['LCP', row.lcpMs, ' ms'], ['TBT', row.tbtMs, ' ms'],
      ['CLS', row.cls], ['Índice de velocidad', row.siMs, ' ms'],
    ]), !!row.reportKey)),
    ...load.map(row => result(row, 'load', row.name, metrics([
      ['Solicitudes', row.totalRequests], ['Solicitudes por segundo', row.reqPerSec], ['Tasa de error', row.failRate, '%'],
      ['Tiempo de respuesta p50', row.p50Ms, ' ms'], ['Tiempo de respuesta p95', row.p95Ms, ' ms'],
      ['Tiempo de respuesta p99', row.p99Ms, ' ms'], ['Máximo de usuarios virtuales', row.maxVus],
      ['Duración', row.durationSec, ' s'],
    ]), !!row.summaryKey)),
    ...ux.map(row => result(row, 'ux', 'Auditoría de usabilidad y accesibilidad', metrics([
      ['Hallazgos', row.totalFindings], ['Críticos', row.criticalCount], ['Mayores', row.majorCount], ['Menores', row.minorCount],
    ]), !!row.reportKey)),
  ];
  return rows.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id));
}

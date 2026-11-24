import { isReportableRunStatus } from '../../../../api/src/runs/run-report-policy';
import { COMPATIBILITY_SCENARIO_TAG, COMPATIBILITY_SCENARIO_TAGS, MANUAL_SCENARIO_TAG } from '../../../../api/src/scenarios/scenario-tags';
import { runPresentation } from './scenario-presentation';

export type ExplainRunFailure = (runId: string, resultId: string) => Promise<string>;

export type RunResult = {
  id: string; status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
  durationMs: number | null; errorMessage: string | null; evidenceKey: string | null;
};
export type ReportRun = {
  id: string; scenarioId: string | null; environmentId: string | null;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  createdAt: string; startedAt: string | null; completedAt: string | null; errorCode: string | null;
  scenario: { id: string; title: string; tags?: string[] } | null; results: RunResult[];
  targetBrowser?: string | null; targetDevice?: string | null; targetProvider?: string | null;
};
export const isManualRun = (run: ReportRun) => run.scenario?.tags?.includes('@manual') ?? run.targetProvider === 'manual';

const reportTags = [
  MANUAL_SCENARIO_TAG, '@funcional', '@mobile', COMPATIBILITY_SCENARIO_TAG,
  '@disponibilidad', '@performance', '@ux', '@flujoBasico', '@flujoAlterno',
] as const;

export function primaryReportTags(tags: readonly string[]): string[] {
  const normalized = new Set(tags.map(tag => tag.trim().toLowerCase()));
  if (COMPATIBILITY_SCENARIO_TAGS.some(tag => normalized.has(tag))) normalized.add(COMPATIBILITY_SCENARIO_TAG);
  return reportTags.filter(tag => normalized.has(tag.toLowerCase()));
}

export const resultLabels = { PASSED: 'Pasó', FAILED: 'Falló', BLOCKED: 'Bloqueada', SKIPPED: 'Omitida' };
export const runLabels = { QUEUED: 'En cola', RUNNING: 'En curso', COMPLETED: 'Completada', FAILED: 'Falló', CANCELED: 'Cancelada' };
export const outcome = (run: ReportRun) => runPresentation(run, true);
export const runTitle = (run: ReportRun) => run.scenario?.title ?? 'Escenario no disponible';
export const milliseconds = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export function durationText(value: number | null) {
  return value === null ? 'No disponible' : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}
export function dateText(value: string | null) {
  return value && milliseconds(value) !== null ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin fecha registrada';
}
export function runtime(run: ReportRun) {
  const start = milliseconds(run.startedAt); const end = milliseconds(run.completedAt);
  return start !== null && end !== null && end >= start ? end - start : null;
}
export function resultDuration(run: ReportRun) {
  const values = run.results.map(result => result.durationMs).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}
export function reportStatistics(runs: ReportRun[]) {
  const results = runs.filter(run => isReportableRunStatus(run.status)).flatMap(run => run.results);
  const counts = Object.fromEntries(Object.keys(resultLabels).map(key => [key, results.filter(result => result.status === key).length])) as Record<RunResult['status'], number>;
  const durations = results.map(result => result.durationMs).filter((value): value is number => value !== null);
  return { counts, results: results.length, rate: results.length ? 100 * counts.PASSED / results.length : null,
    duration: durations.length ? durations.reduce((sum, value) => sum + value, 0) : null, timed: durations.length };
}

const xml = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function junitXml(projectId: string, runs: ReportRun[]) {
  let tests = 0; let failures = 0; let skipped = 0; let errors = 0;
  const suites = runs.map(run => {
    const cases = run.results.length ? run.results.map(result => ({ result, state: result.status }))
      : [{ result: null, state: run.status === 'FAILED' ? 'ERROR' : 'NO_RESULT' }];
    const failedCount = cases.filter(item => item.state === 'FAILED').length;
    const skippedCount = cases.filter(item => ['BLOCKED', 'SKIPPED', 'NO_RESULT'].includes(item.state)).length;
    const errorCount = cases.filter(item => item.state === 'ERROR').length;
    tests += cases.length; failures += failedCount; skipped += skippedCount; errors += errorCount;
    return [`  <testsuite id="${xml(run.id)}" name="${xml(runTitle(run))}" tests="${cases.length}" failures="${failedCount}" skipped="${skippedCount}" errors="${errorCount}">`,
      '    <properties>', `      <property name="autoqa.runId" value="${xml(run.id)}"/>`,
      `      <property name="autoqa.runStatus" value="${xml(run.status)}"/>`,
      `      <property name="autoqa.createdAt" value="${xml(run.createdAt)}"/>`,
      `      <property name="autoqa.environmentId" value="${xml(run.environmentId)}"/>`, '    </properties>',
      ...cases.map(({ result, state }) => {
        const time = result?.durationMs !== null && result?.durationMs !== undefined ? ` time="${result.durationMs / 1000}"` : '';
        const message = result?.errorMessage ?? run.errorCode ?? (state === 'NO_RESULT' ? `${runLabels[run.status]}: sin resultado registrado` : resultLabels[state as keyof typeof resultLabels]);
        const detail = state === 'FAILED' ? `<failure type="FAILED" message="${xml(message)}">${xml(message)}</failure>`
          : state === 'ERROR' ? `<error type="RUN_FAILED" message="${xml(message)}"/>`
          : ['BLOCKED', 'SKIPPED', 'NO_RESULT'].includes(state) ? `<skipped message="${xml(message)}"/>` : '';
        return `    <testcase name="${xml(runTitle(run))}" classname="${xml(projectId)}"${time}>${detail}</testcase>`;
      }), '  </testsuite>'].join('\n');
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites name="AutoQA" tests="${tests}" failures="${failures}" skipped="${skipped}" errors="${errors}">`, ...suites, '</testsuites>', ''].join('\n');
}

export function downloadRunReport(projectId: string, runs: ReportRun[], format: 'xml' | 'json') {
  const finalized = runs.filter(run => isReportableRunStatus(run.status));
  if (!finalized.length) return;
  const content = format === 'xml' ? junitXml(projectId, finalized) : JSON.stringify({ projectId, exportedAt: new Date().toISOString(),
    scope: 'Ejecuciones finalizadas visibles en el reporte', runs: finalized.map(run => ({
      id: run.id, scenarioId: run.scenarioId, title: runTitle(run), status: run.status, environmentId: run.environmentId,
      createdAt: run.createdAt, startedAt: run.startedAt, completedAt: run.completedAt, errorCode: run.errorCode,
      targetBrowser: run.targetBrowser ?? null, targetDevice: run.targetDevice ?? null, targetProvider: run.targetProvider ?? null,
      results: run.results.map(({ evidenceKey, ...result }) => ({ ...result, hasTrace: !!evidenceKey })),
    })) }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: format === 'xml' ? 'application/xml;charset=utf-8' : 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = format === 'xml' ? 'autoqa-runs-junit.xml' : 'autoqa-runs.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

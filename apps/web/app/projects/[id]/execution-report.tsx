'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ResultStatus = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';

type RunResult = {
  id: string;
  status: ResultStatus;
  durationMs: number | null;
  errorMessage: string | null;
  evidenceKey: string | null;
};

type Run = {
  id: string;
  scenarioId: string;
  environmentId: string | null;
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  createdAt: string;
  scenario: { id: string; title: string };
  results: RunResult[];
};

const resultBadge: Record<ResultStatus, string> = {
  PASSED: 'badge-completed', FAILED: 'badge-failed', BLOCKED: 'badge-canceled', SKIPPED: 'badge-queued',
};

const resultLabel: Record<ResultStatus, string> = {
  PASSED: 'Pasó', FAILED: 'Falló', BLOCKED: 'Bloqueada', SKIPPED: 'Omitida',
};

const runStatusLabel: Record<RunStatus, string> = {
  QUEUED: 'En cola', RUNNING: 'En curso', COMPLETED: 'Completada', FAILED: 'Falló', CANCELED: 'Cancelada',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(ms: number | null) {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function totalDuration(run: Run): number | null {
  const sum = run.results.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);
  return sum > 0 ? sum : null;
}

export function ExecutionReport({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/runs`, { credentials: 'same-origin' });
        if (!active) return;
        if (!response.ok) {
          if (response.status === 403) {
            setError('Tu plan actual no incluye ejecuciones de navegador.');
          } else {
            setError('No se pudo cargar el historial de ejecuciones.');
          }
          setRuns([]);
          return;
        }
        setRuns(await response.json());
      } catch {
        if (active) {
          setError('No se pudo comunicar con la API.');
          setRuns([]);
        }
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  if (runs === null) {
    return <section className="panel"><p className="muted">Cargando reporte…</p></section>;
  }

  if (error && runs.length === 0) {
    return (
      <section className="panel">
        <h2>Reporte de ejecución</h2>
        <p className="error" role="alert">{error}</p>
      </section>
    );
  }

  if (runs.length === 0) {
    return (
      <section className="panel">
        <h2>Reporte de ejecución</h2>
        <p className="muted">
          Todavía no se ha ejecutado ningún escenario en este proyecto. Al lanzar un run desde la pestaña
          Escenarios, aparecerán aquí sus resultados con evidencias (capturas, logs, trazas).
        </p>
      </section>
    );
  }

  const allResults = runs.flatMap(r => r.results);
  const totals = {
    runs: runs.length,
    scenarios: new Set(runs.map(r => r.scenarioId)).size,
    passed: allResults.filter(r => r.status === 'PASSED').length,
    failed: allResults.filter(r => r.status === 'FAILED').length,
    blocked: allResults.filter(r => r.status === 'BLOCKED').length,
    skipped: allResults.filter(r => r.status === 'SKIPPED').length,
  };
  const passRate = allResults.length > 0 ? Math.round(100 * totals.passed / allResults.length) : 0;

  // Agrupa por escenario, Allure-style, para que se vea la historia de cada
  // caso de prueba en una sola columna.
  const byScenario = new Map<string, { title: string; runs: Run[] }>();
  for (const run of runs) {
    const key = run.scenarioId;
    const entry = byScenario.get(key) ?? { title: run.scenario.title, runs: [] };
    entry.runs.push(run);
    byScenario.set(key, entry);
  }

  return (
    <>
      <section className="panel">
        <header className="projects-panel__head">
          <div>
            <h2 style={{ margin: 0 }}>Reporte de ejecución</h2>
            <p className="muted" style={{ margin: 0 }}>
              Últimos {totals.runs} runs sobre {totals.scenarios} escenario{totals.scenarios === 1 ? '' : 's'}.
              Tasa de aprobación: <strong>{passRate}%</strong>.
            </p>
          </div>
          <Link href={`/projects/${projectId}/report`} className="button-like outline">
            Reporte consolidado →
          </Link>
        </header>

        <div className="report-totals">
          <div className="report-total">
            <span className="report-total__value">{totals.passed}</span>
            <span className="report-total__label">Pasaron</span>
          </div>
          <div className="report-total">
            <span className="report-total__value">{totals.failed}</span>
            <span className="report-total__label">Fallaron</span>
          </div>
          <div className="report-total">
            <span className="report-total__value">{totals.blocked}</span>
            <span className="report-total__label">Bloqueados</span>
          </div>
          <div className="report-total">
            <span className="report-total__value">{totals.skipped}</span>
            <span className="report-total__label">Omitidos</span>
          </div>
        </div>
      </section>

      {Array.from(byScenario.entries()).map(([scenarioId, group]) => (
        <section className="panel" key={scenarioId}>
          <header className="projects-panel__head">
            <h3 style={{ margin: 0 }}>
              <Link href={`/projects/${projectId}/scenarios/${scenarioId}`}>{group.title}</Link>
            </h3>
            <span className="muted">{group.runs.length} ejecucion{group.runs.length === 1 ? '' : 'es'}</span>
          </header>

          <ul className="run-list">
            {group.runs.map(run => {
              const duration = totalDuration(run);
              const failed = run.results.filter(r => r.status === 'FAILED');
              return (
                <li key={run.id} className="run-item">
                  <div className="run-item__head">
                    <span className={`badge ${run.status === 'COMPLETED' ? 'badge-completed'
                      : run.status === 'FAILED' ? 'badge-failed'
                      : run.status === 'RUNNING' ? 'badge-queued' : 'badge-queued'}`}>
                      {runStatusLabel[run.status]}
                    </span>
                    <span className="muted"><small>{formatDate(run.createdAt)}</small></span>
                    <span className="muted"><small>· duración {formatDuration(duration)}</small></span>
                    {run.errorCode && <span className="error"><small>· {run.errorCode}</small></span>}
                  </div>

                  {run.results.length > 0 && (
                    <div className="run-item__results">
                      {run.results.map(r => (
                        <span key={r.id} className={`badge ${resultBadge[r.status]}`} title={r.errorMessage ?? undefined}>
                          {resultLabel[r.status]} · {formatDuration(r.durationMs)}
                        </span>
                      ))}
                    </div>
                  )}

                  {failed.length > 0 && failed[0].errorMessage && (
                    <details className="run-item__error">
                      <summary><small>Ver mensaje de error ({failed.length})</small></summary>
                      <pre>{failed[0].errorMessage}</pre>
                    </details>
                  )}

                  {run.results.some(r => r.evidenceKey) && (
                    <p className="run-item__evidence">
                      <small className="muted">Evidencias:</small>{' '}
                      {run.results.filter(r => r.evidenceKey).map((r, i) => (
                        <Link key={r.id}
                          href={`/api/projects/${projectId}/runs/${run.id}/trace/${r.id}`}
                          target="_blank" rel="noreferrer">
                          <small>traza #{i + 1} ↗</small>
                        </Link>
                      )).reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, ' · ', el], [])}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

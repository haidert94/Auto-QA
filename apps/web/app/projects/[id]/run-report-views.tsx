'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Download, ExternalLink, Image as ImageIcon, X } from 'lucide-react';
import { dateText, durationText, isManualRun, milliseconds, outcome, resultDuration, resultLabels, runLabels, runTitle, runtime, type ReportRun } from './run-report-data';
import { RunEvidenceModal } from './evidence-modal';
import { isReportableRunStatus } from '../../../../api/src/runs/run-report-policy';
import { ManualEvidenceButton } from './manual-evidence';

export type RunFilter = 'all' | 'passed' | 'failed' | 'blocked' | 'skipped' | 'pending' | 'empty';
export const filterLabels: Record<RunFilter, string> = { all: 'Todos', passed: 'Exitosos', failed: 'Fallidos', blocked: 'Bloqueados', skipped: 'Omitidos', pending: 'En cola / curso', empty: 'Sin resultado' };
export function category(run: ReportRun): Exclude<RunFilter, 'all'> {
  if (run.status === 'QUEUED' || run.status === 'RUNNING') return 'pending';
  if (run.status === 'FAILED' || run.results.some(result => result.status === 'FAILED')) return 'failed';
  if (run.status === 'CANCELED') return 'empty';
  if (run.results.some(result => result.status === 'BLOCKED')) return 'blocked';
  if (run.results.some(result => result.status === 'SKIPPED')) return 'skipped';
  return run.results.length && run.results.every(result => result.status === 'PASSED') ? 'passed' : 'empty';
}

export function TraceLink({ projectId, run, resultId }: { projectId: string; run: ReportRun; resultId: string }) {
  return <a className="run-trace-link" href={`/api/projects/${projectId}/runs/${run.id}/trace/${resultId}`}
    download={`trace-${resultId}.zip`} aria-label={`Descargar traza ${resultId.slice(0, 8)} de ${runTitle(run)}`}><Download size={12} />Traza</a>;
}

export function EvidenceAction({ projectId, run, result }: {
  projectId: string; run: ReportRun; result: { id: string; status: string; evidenceKey?: string | null };
}) {
  const [open, setOpen] = useState(false);
  if (!isReportableRunStatus(run.status)) return null;
  const label = runTitle(run);
  const manualScenarioId = isManualRun(run) ? run.scenarioId : null;
  return <>
    {!run.id.startsWith('manual-pending-') && <button type="button" className="run-trace-link" onClick={() => setOpen(true)}
      aria-label={`Ver evidencias de ${label}`}><ImageIcon size={12} /> Evidencias</button>}
    {result.evidenceKey && <TraceLink projectId={projectId} run={run} resultId={result.id} />}
    {manualScenarioId && <ManualEvidenceButton projectId={projectId} scenarioId={manualScenarioId}
      resultId={result.id} currentStatus={result.status as 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED'}
      onSaved={() => { if (typeof window !== 'undefined') window.location.reload(); }} />}
    {open && <RunEvidenceModal projectId={projectId} runId={run.id} resultId={result.id} title={label} onClose={() => setOpen(false)} />}
  </>;
}

export function RunsTable({ projectId, runs, tags, tagsAvailable, detailId, onDetail }: {
  projectId: string; runs: ReportRun[]; tags: Map<string, string[]>; tagsAvailable: boolean; detailId: string | null; onDetail: (id: string) => void;
}) {
  return <div className="run-report-table-scroll" tabIndex={0} aria-label="Tabla de ejecuciones desplazable"><table className="run-report-table" aria-label="Ejecuciones registradas">
    <thead><tr><th>ID y escenario</th><th>Etiquetas actuales</th><th>Navegador</th><th>Duración</th><th>Estado</th><th>Evidencias</th></tr></thead>
    <tbody>{runs.map(run => {
      const status = outcome(run); const values = run.scenarioId ? tags.get(run.scenarioId) ?? [] : [];
      return <tr key={run.id} className={detailId === run.id ? 'run-report-row--current' : undefined}>
        <td><code title={run.id}>{run.id.slice(0, 8)}</code><button type="button" aria-pressed={detailId === run.id} onClick={() => onDetail(run.id)}>{runTitle(run)}</button>
          <time dateTime={run.createdAt}>{dateText(run.createdAt)}</time></td>
        <td><div className="run-report-tags">{values.length ? values.map(value => <span key={value}>{value}</span>) : <small>{tagsAvailable ? 'Sin etiquetas' : 'No disponibles'}</small>}</div></td>
        <td><span>{run.targetBrowser ?? 'Sin registrar'}</span>{run.targetDevice && <small>{run.targetDevice}</small>}</td>
        <td>{durationText(resultDuration(run))}</td>
        <td><span className={`run-report-state run-report-state--${status.tone}`}>{status.label}</span>{run.errorCode && <small className="error">{run.errorCode}</small>}</td>
        <td><div className="run-report-traces">{run.results.length ? run.results.map(result => <EvidenceAction key={result.id} projectId={projectId} run={run} result={result} />) : <small>Sin evidencias</small>}</div></td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function RunDetail({ run, projectId, onClose }: { run: ReportRun; projectId: string; onClose: () => void }) {
  const status = outcome(run);
  return <section className="run-report-detail" aria-label="Detalle de ejecución">
    <header><h3>Detalle · {run.id.slice(0, 8)}</h3><button type="button" aria-label="Cerrar detalle de ejecución" onClick={onClose}><X size={15} /></button></header>
    <div className="run-report-detail__body"><h4>{runTitle(run)}</h4>
      <span className={`run-report-state run-report-state--${status.tone}`}>{status.label}</span>
      <dl><div><dt>Estado del run</dt><dd>{runLabels[run.status]}</dd></div><div><dt>Creado</dt><dd>{dateText(run.createdAt)}</dd></div>
        <div><dt>Tiempo de ejecución</dt><dd>{durationText(runtime(run))}</dd></div><div><dt>Resultados</dt><dd>{run.results.length}</dd></div>
        <div><dt>Navegador</dt><dd>{run.targetBrowser ?? 'Sin registrar'}</dd></div><div><dt>Proveedor</dt><dd>{run.targetProvider ?? 'Sin registrar'}</dd></div></dl>
      {run.errorCode && <p className="error">{run.errorCode}</p>}
      <ul>{run.results.map(result => <li key={result.id}><strong>{resultLabels[result.status]}</strong><span>{durationText(result.durationMs)}</span>
        {result.errorMessage && <details><summary>Ver mensaje de error</summary><pre>{result.errorMessage}</pre></details>}
        <EvidenceAction projectId={projectId} run={run} result={result} />
      </li>)}</ul>
      {!run.results.length && <p className="muted">Esta ejecución aún no tiene resultados registrados.</p>}
      {run.scenarioId && <Link className="run-report-detail__link" href={`/projects/${projectId}/scenarios/${run.scenarioId}`}><ExternalLink size={13} />Abrir escenario y ejecuciones</Link>}
    </div>
  </section>;
}

export function RunTimeline({ runs, onDetail }: { runs: ReportRun[]; onDetail: (id: string) => void }) {
  const timed = runs.flatMap(run => {
    const start = milliseconds(run.startedAt); const end = milliseconds(run.completedAt);
    return start !== null && end !== null && end >= start ? [{ run, start, end }] : [];
  });
  const first = Math.min(...timed.map(item => item.start)); const last = Math.max(...timed.map(item => item.end));
  return <section className="run-report-timeline" aria-label="Cronología de ejecuciones"><h3>Cronología de ejecuciones</h3>
    <p>{timed.length} de {runs.length} ejecuciones visibles tienen inicio y fin registrados.</p>
    {!timed.length ? <p className="muted">No hay marcas de tiempo suficientes para dibujar la cronología.</p>
      : <><div className="run-timeline-axis"><span>{dateText(new Date(first).toISOString())}</span><span>{dateText(new Date(last).toISOString())}</span></div>
        <ul>{timed.map(({ run, start, end }) => <li key={run.id}>
          <button type="button" onClick={() => onDetail(run.id)}>{runTitle(run)}</button>
          <div className="run-timeline-track" role="img" aria-label={`${runTitle(run)}: ${durationText(end - start)}`}><span className={`run-timeline-bar run-timeline-bar--${category(run)}`}
            style={{ marginLeft: `${100 * (start - first) / Math.max(1, last - first)}%`, width: `${100 * (end - start) / Math.max(1, last - first)}%` }} /></div>
          <span>{durationText(end - start)}</span>
        </li>)}</ul></>}
  </section>;
}

export function RunMatrix({ runs }: { runs: ReportRun[] }) {
  const keys = ['passed', 'failed', 'blocked', 'skipped', 'pending', 'empty'] as const;
  const groups = new Map<string, { title: string; values: Record<typeof keys[number], number> }>();
  for (const run of runs) {
    const key = run.scenarioId ?? run.id;
    const group = groups.get(key) ?? { title: runTitle(run), values: { passed: 0, failed: 0, blocked: 0, skipped: 0, pending: 0, empty: 0 } };
    group.values[category(run)]++; groups.set(key, group);
  }
  return <div className="run-report-table-scroll" tabIndex={0} aria-label="Matriz de estados desplazable"><table className="run-report-table run-report-matrix" aria-label="Matriz de estados por escenario">
    <thead><tr><th>Escenario</th>{keys.map(key => <th key={key}>{filterLabels[key]}</th>)}</tr></thead>
    <tbody>{[...groups].map(([id, group]) => <tr key={id}><th scope="row">{group.title}</th>{keys.map(key => <td key={key}>{group.values[key]}</td>)}</tr>)}</tbody>
  </table></div>;
}

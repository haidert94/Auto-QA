'use client';

import { Activity, Image as ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AvailabilityCheck, QualityResult, QualityResultKind, UxResultDetail } from '../../../../api/src/reports/quality-results';
import { dateText, durationText } from './run-report-data';
import { ScenarioPagination, useScenarioPagination } from './scenario-pagination';

const kinds = {
  availability: 'Disponibilidad',
  lighthouse: 'Lighthouse',
  load: 'Carga k6',
  ux: 'UX',
} as const satisfies Record<QualityResultKind, string>;

const statuses: Record<QualityResult['status'], string> = {
  available: 'Disponible', unavailable: 'No disponible', completed: 'Finalizada', failed: 'Falló', unknown: 'Sin estado registrado',
};
const statusTone: Record<QualityResult['status'], string> = {
  available: 'passed', unavailable: 'failed', completed: 'empty', failed: 'failed', unknown: 'empty',
};
const severity: Record<string, string> = { critical: 'Crítico', major: 'Mayor', minor: 'Menor', unknown: 'Sin clasificar' };

function QualityEvidence({ source, projectId }: { source: QualityResult; projectId: string }) {
  const [data, setData] = useState<{ kind: 'availability'; checks: AvailabilityCheck[] } | { kind: 'ux'; detail: UxResultDetail } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const path = `/api/projects/${projectId}/report/quality/${source.kind}/${source.id}`;

  useEffect(() => {
    if (source.kind !== 'availability' && source.kind !== 'ux') return;
    const controller = new AbortController();
    const kind = source.kind;
    fetch(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Este detalle todavía no está disponible.');
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (kind === 'availability' && Array.isArray(payload)) setData({ kind, checks: payload });
        else if (kind === 'ux' && Array.isArray(payload?.findings)) setData({ kind, detail: payload });
        else throw new Error('La respuesta de evidencias no es válida.');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo consultar el detalle.');
      });
    return () => controller.abort();
  }, [path, source.kind, source.recordedAt, retry]);

  if (error) return <div><p className="muted" role="status">{error}</p><button type="button" className="secondary" onClick={() => {
    setError(''); setRetry(value => value + 1);
  }}>Reintentar consulta</button></div>;
  if (!data) return <p className="muted" role="status">Consultando detalle…</p>;

  if (data.kind === 'availability') return data.checks.length === 0
    ? <p className="muted">Sin historial de comprobaciones.</p>
    : <div className="quality-result-table">
      <p>Disponibilidad en las últimas {data.checks.length} comprobaciones: {Math.round(
        100 * data.checks.filter(check => check.status === 'UP').length / data.checks.length
      )} %</p>
      <table className="trace-table" aria-label="Historial de disponibilidad">
      <thead><tr><th>Fecha</th><th>Estado</th><th>HTTP</th><th>Latencia</th><th>Error</th></tr></thead>
      <tbody>{data.checks.map(check => <tr key={check.id}>
        <td>{dateText(check.at)}</td>
        <td>{check.status === 'UP' ? 'Disponible' : check.status === 'DOWN' ? 'No disponible' : 'Sin estado registrado'}</td>
        <td>{check.httpStatus ?? '—'}</td><td>{durationText(check.latencyMs)}</td><td>{check.error ?? '—'}</td>
      </tr>)}</tbody>
    </table></div>;

  return <div className="quality-result-findings">
    {data.detail.summary && <p>{data.detail.summary}</p>}
    {data.detail.findings.length ? <ul>{data.detail.findings.map((finding, index) => <li key={index}>
      <strong>{severity[finding.severity] ?? severity.unknown} · {finding.summary}</strong>
      {finding.recommendation && <p>{finding.recommendation}</p>}
    </li>)}</ul> : <p className="muted">Sin hallazgos detallados registrados.</p>}
    {data.detail.hasScreenshot && <figure className="quality-result-screenshot">
      <img src={path + '/screenshot'} alt="Captura de la auditoría UX" loading="lazy" />
      <figcaption><a href={path + '/screenshot'} download="captura-ux.png">Descargar captura UX</a></figcaption>
    </figure>}
  </div>;
}

function QualityResultStatus({ status }: { status: QualityResult['status'] }) {
  return <span className={`run-report-state run-report-state--${statusTone[status]}`}>{statuses[status]}</span>;
}

function QualityResultDetail({ row, projectId, onClose }: { row: QualityResult; projectId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const monitor = row.kind === 'availability';

  useEffect(() => {
    const trigger = document.activeElement;
    const panel = dialog.current;
    panel?.showModal();
    return () => {
      panel?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialog} className="evidence-modal__box quality-result-detail"
    aria-label={`${monitor ? 'Monitoreo' : 'Detalle de calidad'} de ${row.title}`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header>
      <div><h3>{row.title}</h3><small>{kinds[row.kind]} · {dateText(row.recordedAt)}</small></div>
      <button type="button" aria-label="Cerrar detalle" onClick={onClose}><X size={17} aria-hidden="true" /></button>
    </header>
    <div className="run-evidence-content">
      <div className="quality-result-detail-summary">
        <QualityResultStatus status={row.status} />
        {row.target && <code>{row.target}</code>}
      </div>
      {row.error && <p className="error">{row.error}</p>}
      {row.metrics.length > 0 && <dl className="quality-result-metrics">{row.metrics.map(metric =>
        <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}
      {monitor && <section aria-label="Historial del monitor">
        <h4>Historial del monitor</h4>
        <QualityEvidence source={row} projectId={projectId} />
      </section>}
      {row.hasEvidence && row.kind === 'ux' && <QualityEvidence source={row} projectId={projectId} />}
      {row.hasEvidence && row.kind === 'lighthouse' && <a href={`/api/projects/${projectId}/audits/${row.id}/report`}
        download={`lighthouse-${row.id}.json`}>Descargar informe Lighthouse</a>}
      {row.hasEvidence && row.kind === 'load' && <a href={`/api/projects/${projectId}/load-tests/${row.id}/summary`}
        download={`k6-${row.id}.json`}>Descargar resumen k6</a>}
      {!monitor && !row.hasEvidence && <p className="muted">Sin archivos de evidencia guardados.</p>}
    </div>
  </dialog>;
}

export function QualityResultsReport({ projectId, active, refreshKey }: { projectId: string; active: boolean; refreshKey?: number }) {
  const [rows, setRows] = useState<QualityResult[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [kind, setKind] = useState<'all' | QualityResultKind>('all');
  const [detail, setDetail] = useState<string | null>(null);
  const filtered = (rows ?? []).filter(item => kind === 'all' || item.kind === kind);
  const { visible, results, resetPage, pagination } = useScenarioPagination<QualityResult, HTMLDivElement>(filtered);
  const selected = filtered.find(row => detail === row.kind + ':' + row.id);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const response = await fetch(`/api/projects/${projectId}/report/quality`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), cache: 'no-store',
        });
        if (response.status === 403) {
          if (!controller.signal.aborted) setRows(null);
          throw new Error('Tu plan o tus permisos no permiten consultar estos resultados.');
        }
        if (!response.ok) throw new Error('No se pudieron consultar los resultados de calidad.');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('La API no devolvió una lista de resultados.');
        if (!controller.signal.aborted) { setRows(data); setError(''); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudieron consultar los resultados de calidad.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void read(), 10000);
      }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, projectId, refreshKey, retry]);

  function exportResults() {
    const blob = new Blob([JSON.stringify({ projectId, results: filtered }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'autoqa-resultados-calidad.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="quality-results-report" aria-label="Resultados de calidad">
    <h2>Resultados de calidad</h2>
    <section className="run-report-filters">
      <div>
        <label>Tipo de prueba <select value={kind} onChange={event => {
          setKind(event.target.value as typeof kind);
          setDetail(null);
          resetPage();
        }}>
          <option value="all">Todos</option>
          {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <button type="button" className="secondary" disabled={!filtered.length || !!error} onClick={exportResults}>Exportar resultados de calidad</button>
      </div>
      {rows && <p role="status">{filtered.length} resultados · Hasta 100 registros recientes por tipo</p>}
    </section>
    {error && <div className="run-report-message" role="alert"><p>{error}</p><button type="button" className="secondary"
      onClick={() => setRetry(value => value + 1)}>Reintentar reporte de calidad</button></div>}
    {!rows && !error && <p className="run-report-message" role="status">Consultando resultados de calidad…</p>}
    {rows && !filtered.length && <p className="run-report-message">Aún no hay resultados finalizados para los tipos seleccionados.</p>}
    {visible.length > 0 && <div className="run-report-table-scroll quality-results-table-scroll" ref={results} tabIndex={-1}>
      <table className="run-report-table quality-results-table" aria-label="Ejecuciones de calidad">
        <thead><tr>
          <th scope="col">ID y escenario</th><th scope="col">Tipo de prueba</th><th scope="col">Resultado</th>
          <th scope="col">Estado</th><th scope="col">Evidencias</th>
        </tr></thead>
        <tbody>{visible.map(row => {
          const key = row.kind + ':' + row.id;
          const monitor = row.kind === 'availability';
          const action = monitor ? 'Monitoreo' : row.hasEvidence ? 'Evidencias' : 'Ver detalle';
          const summary = row.metrics.slice(0, monitor ? 2 : 1);
          return <tr key={key}>
            <td>
              <code title={row.id}>{row.id.slice(0, 8)}</code>
              <strong className="quality-result-title">{row.title}</strong>
              <time dateTime={row.recordedAt}>{dateText(row.recordedAt)}</time>
            </td>
            <td>{kinds[row.kind]}</td>
            <td>{summary.length ? <dl className="quality-result-summary">{summary.map(metric =>
              <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl> : 'Sin métricas'}
            </td>
            <td><QualityResultStatus status={row.status} />{row.error && <small className="error">{row.error}</small>}</td>
            <td><div className="run-report-traces">
              <button type="button" className="run-trace-link" aria-label={`${action} de ${row.title}`} aria-haspopup="dialog"
                onClick={() => setDetail(key)}>
                {monitor ? <Activity size={12} aria-hidden="true" /> : <ImageIcon size={12} aria-hidden="true" />} {action}
              </button>
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {active && selected && <QualityResultDetail key={detail} projectId={projectId} row={selected} onClose={() => setDetail(null)} />}
    {filtered.length > 0 && <ScenarioPagination label="Paginación de resultados de calidad" {...pagination} />}
  </section>;
}

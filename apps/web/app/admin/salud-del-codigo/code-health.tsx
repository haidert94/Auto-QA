import { AlertTriangle, CheckCircle2, ExternalLink, GitBranch, ShieldAlert } from 'lucide-react';
import { EvaluationCard, Score } from '../../quality-evaluation-card';
import type { AlertCounts, AlertDetail, CodeHealthResult, WorkflowRunSummary } from '../../../../api/src/quality/code-health.service';

const alertLabels = {
  critical: 'Alertas críticas', high: 'Alertas altas', error: 'Errores de código', medium: 'Alertas medias',
  warning: 'Avisos de código', low: 'Alertas bajas', note: 'Notas', other: 'Otras alertas',
} satisfies Record<AlertDetail['severity'], string>;

function severityLabel(severity: AlertDetail['severity']): string {
  return { critical: 'Crítica', high: 'Alta', error: 'Error', medium: 'Media',
    warning: 'Aviso', low: 'Baja', note: 'Nota', other: 'Otra' }[severity] ?? severity;
}

function isFailedRun(run: WorkflowRunSummary): boolean {
  return run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'startup_failure';
}

function runColor(run: WorkflowRunSummary): string {
  if (run.conclusion === 'success') return 'var(--success, #15803d)';
  if (isFailedRun(run)) return 'var(--danger, #b91c1c)';
  if (run.conclusion === 'cancelled') return 'var(--muted)';
  return 'var(--warn, #b45309)';
}

function AlertBreakdown({ total, count }: { total: number; count: (severity: AlertDetail['severity']) => number }) {
  if (!total) return null;
  const levels = Object.keys(alertLabels) as AlertDetail['severity'][];
  return <ol className="quality-dimensions code-health-dims">
    {levels.map(level => ({ level, value: count(level) })).filter(row => row.value > 0).map(({ level, value }) => {
      const percentage = 100 * value / total;
      return <li key={level} className={`code-health-dim is-${level}`}>
        <div><strong>{alertLabels[level]}</strong><span>{Math.round(percentage)}% <small>({value}/{total})</small></span></div>
        <div className="quality-progress"><span style={{ width: `${Math.max(2, percentage)}%` }} /></div>
      </li>;
    })}
  </ol>;
}

function AlertsChart({ title, counts, url, top }: { title: string; counts: AlertCounts; url: string | null; top: AlertDetail[] }) {
  return <div className="code-health-alerts">
    <header><h4>{title}</h4><strong>{counts.total}</strong>
      {url && <a href={url} target="_blank" rel="noreferrer" aria-label={`Ver ${title} en GitHub`}><ExternalLink size={12} /></a>}</header>
    {counts.total ? <AlertBreakdown total={counts.total} count={severity => counts[severity] ?? 0} />
      : <p className="muted">Sin alertas abiertas.</p>}
    {top.length > 0 && <ol className="code-health-list">{top.map(alert => <li key={alert.id} className={`code-health-item is-${alert.severity}`}>
      <a href={alert.url} target="_blank" rel="noreferrer">{alert.title}</a>
      <span className={`code-health-badge is-${alert.severity}`}>{severityLabel(alert.severity)}</span>
      {alert.package && <small>{alert.package}</small>}
      {alert.location && <small><code>{alert.location}</code></small>}
    </li>)}</ol>}
  </div>;
}

function RunsChart({ workflow }: { workflow: NonNullable<CodeHealthResult['workflow']> }) {
  const { recent: runs, successRate, evaluated, succeeded, url } = workflow;
  const latestFailure = runs.find(isFailedRun);
  // Minigráfica: últimos 20 runs como barritas de alto fijo. No usamos
  // librería porque un SVG inline cumple y evita 100 KB extra en el bundle.
  if (!runs.length) return <p className="muted">Sin ejecuciones disponibles. {url && <a href={url} target="_blank" rel="noreferrer">Abrir CI en GitHub</a>}</p>;
  const width = 300; const height = 60; const barGap = 2;
  const barWidth = Math.max(4, (width - barGap * (runs.length - 1)) / runs.length);
  return <div className="code-health-runs">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Últimas ${runs.length} corridas del CI`}>
      {runs.slice().reverse().map((run, i) => <rect key={run.id}
        x={i * (barWidth + barGap)} y={6} width={barWidth} height={height - 12}
        fill={runColor(run)} rx={1}>
        <title>{`${run.headSha} · ${run.conclusion ?? run.status} · ${new Date(run.createdAt).toLocaleString('es-CO')}`}</title>
      </rect>)}
    </svg>
    <small>{successRate === null ? 'Sin ejecuciones evaluables.' : `${Math.round(successRate * 100)}% de éxito${evaluated ? ` (${succeeded}/${evaluated})` : ''}`}
      {' · '}{runs.length} ejecuciones recientes</small>
    {latestFailure?.url ? <a href={latestFailure.url} target="_blank" rel="noreferrer">Abrir última ejecución fallida</a>
      : url && <a href={url} target="_blank" rel="noreferrer">Abrir CI en GitHub</a>}
  </div>;
}

export function CodeHealthOverview({ data }: { data: CodeHealthResult }) {
  const count = (key: keyof AlertCounts) => (data.codeql?.counts[key] ?? 0) + (data.dependabot?.counts[key] ?? 0);
  const alertsTotal = count('total');
  const critical = count('critical');
  const high = count('high');
  const medium = count('medium');
  const workflowRate = data.workflow?.successRate;
  const alertsAvailable = !!(data.codeql?.enabled || data.dependabot?.enabled);
  const hasData = alertsAvailable || workflowRate != null;

  // Score por niveles, no lineal: 100 si no hay nada; cada severidad
  // tiene un tope de penalización para que una dimensión sola no coma
  // todo el puntaje. Bajas y notas son informativas: no restan.
  const score = !hasData ? null : Math.max(0, Math.min(100, Math.round(
    100
    - Math.min(40, critical * 12)
    - Math.min(25, high * 3)
    - Math.min(15, Math.max(0, medium - 5) * 1)
    - (workflowRate !== null && workflowRate !== undefined ? (1 - workflowRate) * 20 : 0),
  )));

  // Nivel y badge expresan el estado de SALUD del código: 100 = salud
  // excelente (sin alertas), menos = problemas detectados proporcionales
  // a la severidad máxima.
  const level = !hasData ? null
    : critical > 0 ? 'SALUD CRÍTICA'
    : high > 0 ? 'SALUD BAJA'
    : !alertsAvailable ? 'SOLO CI'
    : medium > 0 || count('error') > 0 || (workflowRate != null && workflowRate < 1) ? 'SALUD PARCIAL'
    : alertsTotal > 0 ? 'SALUD BUENA'
    : 'SALUD EXCELENTE';
  const badge = level ? `${level} · ${alertsTotal} alerta${alertsTotal === 1 ? '' : 's'}` : 'Sin evaluación';

  const headline = !hasData ? 'No hay datos de GitHub disponibles para evaluar el código.'
    : critical > 0 ? 'Hay alertas críticas de seguridad por resolver.'
    : high > 0 ? 'Hay alertas altas en el código o sus dependencias.'
    : count('error') > 0 ? 'CodeQL detectó errores en el código.'
    : workflowRate != null && workflowRate < 1 ? 'Revisa las ejecuciones fallidas del CI.'
    : medium > 0 ? 'Hay alertas de severidad media por revisar.'
    : alertsTotal > 0 ? 'Hay alertas de código o dependencias por revisar.'
    : alertsAvailable ? 'Las fuentes consultadas no reportan alertas abiertas.'
    : 'Hay datos del CI. Las fuentes de alertas están pendientes de consulta.';

  return <EvaluationCard index="01" title="Estado del repositorio" badge={badge}>
    <div className="quality-evaluation__body">
      <div className="quality-score-summary"><Score label="Estado de salud del código" value={score} /><div>
        <h3>{headline}</h3>
        <p>{alertsAvailable ? `${alertsTotal} alerta${alertsTotal === 1 ? '' : 's'} abierta${alertsTotal === 1 ? '' : 's'}` : 'Alertas sin datos'}
          {workflowRate == null ? ' · CI sin resultado evaluable' : ` · CI ${Math.round(workflowRate * 100)}% de éxito`}</p>
        {data.repository && <small><GitBranch size={12} /> {data.repository}</small>}
      </div></div>
      <AlertBreakdown total={alertsTotal} count={count} />
      <a className="quality-detail-link" href="#detalle">
        {alertsTotal > 0 ? 'Ver detalle de CI, CodeQL y Dependabot →' : 'Ver estado del CI y del escáner →'}
      </a>
    </div>
  </EvaluationCard>;
}

export function CodeHealthDetail({ data }: { data: CodeHealthResult }) {
  return <div className="code-health-grid">
    <div className="code-health-widget">
      <header>{data.workflow?.recent.some(r => r.conclusion === 'failure') ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
        <h3>CI · {data.workflow?.name ?? '—'}</h3></header>
      {data.workflow ? <RunsChart workflow={data.workflow} /> : <p className="muted">Sin workflow configurado.</p>}
    </div>
    <div className="code-health-widget">
      <header><ShieldAlert size={14} /><h3>CodeQL</h3></header>
      {data.codeql?.enabled ? <AlertsChart title="Alertas CodeQL" counts={data.codeql.counts} url={data.codeql.url} top={data.codeql.top ?? []} />
        : <p className="muted">CodeQL sin datos disponibles. Revisa el workflow <code>codeql.yml</code> y el acceso de AutoQA en GitHub.</p>}
    </div>
    <div className="code-health-widget">
      <header><ShieldAlert size={14} /><h3>Dependabot</h3></header>
      {data.dependabot?.enabled ? <AlertsChart title="Alertas Dependabot" counts={data.dependabot.counts} url={data.dependabot.url} top={data.dependabot.top ?? []} />
        : <p className="muted">Dependabot sin datos disponibles. Revisa las alertas y el acceso de AutoQA en GitHub.</p>}
    </div>
  </div>;
}

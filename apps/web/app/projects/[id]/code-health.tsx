'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ExternalLink, GitBranch } from 'lucide-react';
import { EvaluationCard, Score } from './quality-panel';

type AlertCounts = { critical: number; high: number; medium: number; low: number; note: number; other: number; total: number };
type WorkflowRun = { id: number; status: string; conclusion: string | null; createdAt: string; url: string; headSha: string };
type AlertDetail = { id: number; severity: string; title: string; location: string | null; url: string; package?: string };
type CodeHealth = {
  configured: boolean;
  repository: string | null;
  fetchedAt: string;
  workflow: { name: string; recent: WorkflowRun[]; successRate: number | null } | null;
  codeql: { enabled: boolean; counts: AlertCounts; url: string | null; top: AlertDetail[] } | null;
  dependabot: { enabled: boolean; counts: AlertCounts; url: string | null; top: AlertDetail[] } | null;
  message?: string;
};

function severityLabel(severity: string): string {
  return ({ critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja', note: 'Nota', warning: 'Aviso' } as Record<string, string>)[severity] ?? severity;
}

function runColor(run: WorkflowRun): string {
  if (run.conclusion === 'success') return 'var(--success, #15803d)';
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'var(--danger, #b91c1c)';
  if (run.conclusion === 'cancelled') return 'var(--muted)';
  return 'var(--warn, #b45309)';
}

export function AlertsChart({ title, counts, url, top }: { title: string; counts: AlertCounts; url: string | null; top: AlertDetail[] }) {
  // Usa la misma estética de .quality-dimensions (IPA/ICSP): una fila por
  // severidad con etiqueta, conteo y barra de progreso. El denominador es
  // el total de alertas del tipo, no la severidad más poblada, para que
  // "crítica 2 / total 22" pese visualmente lo correcto.
  const palette: Array<[keyof AlertCounts, string]> = [
    ['critical', 'Críticas'], ['high', 'Altas'],
    ['medium', 'Medias'], ['low', 'Bajas'],
    ['note', 'Nota'], ['other', 'Otras'],
  ];
  const total = counts.total || 1;
  return <div className="code-health-alerts">
    <header><h4>{title}</h4><strong>{counts.total}</strong>
      {url && <a href={url} target="_blank" rel="noreferrer" aria-label={`Ver ${title} en GitHub`}><ExternalLink size={12} /></a>}</header>
    {counts.total === 0 ? <p className="muted">Sin alertas abiertas.</p>
      : <ol className="quality-dimensions code-health-dims">{palette.filter(([key]) => counts[key] > 0).map(([key, label]) => <li key={key} className={`code-health-dim is-${key}`}>
        <div><strong>{label}</strong><span>{Math.round(100 * counts[key] / total)}% <small>({counts[key]}/{counts.total})</small></span></div>
        <div className="quality-progress"><span style={{ width: `${Math.max(2, 100 * counts[key] / total)}%` }} /></div>
      </li>)}</ol>}
    {top.length > 0 && <ol className="code-health-list">{top.map(alert => <li key={alert.id} className={`code-health-item is-${alert.severity}`}>
      <a href={alert.url} target="_blank" rel="noreferrer">{alert.title}</a>
      <span className={`code-health-badge is-${alert.severity}`}>{severityLabel(alert.severity)}</span>
      {alert.package && <small>{alert.package}</small>}
      {alert.location && <small><code>{alert.location}</code></small>}
    </li>)}</ol>}
  </div>;
}

export function RunsChart({ runs, successRate }: { runs: WorkflowRun[]; successRate: number | null }) {
  // Minigráfica: últimos 20 runs como barritas de alto fijo. No usamos
  // librería porque un SVG inline cumple y evita 100 KB extra en el bundle.
  if (!runs.length) return <p className="muted">Sin corridas registradas aún.</p>;
  const width = 300; const height = 60; const barGap = 2;
  const barWidth = Math.max(4, (width - barGap * (runs.length - 1)) / runs.length);
  return <div className="code-health-runs">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Últimas ${runs.length} corridas del CI`}>
      {runs.slice().reverse().map((run, i) => <rect key={run.id}
        x={i * (barWidth + barGap)} y={6} width={barWidth} height={height - 12}
        fill={runColor(run)} rx={1}>
        <title>{run.headSha} · {run.conclusion ?? run.status} · {new Date(run.createdAt).toLocaleString('es-CO')}</title>
      </rect>)}
    </svg>
    <small>{successRate === null ? 'Sin datos de éxito.' : `Tasa de éxito: ${(successRate * 100).toFixed(0)}%`} · {runs.length} corridas recientes.</small>
  </div>;
}

export function CodeHealthCard({ active, projectId }: { active: boolean; projectId: string }) {
  const [data, setData] = useState<CodeHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch('/api/quality/code-health', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('No se pudo consultar la salud del código.');
        const body = await response.json();
        if (!controller.signal.aborted) setData(body);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No disponible.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active]);

  // Score consolidado: 100 = sin alertas ni CI roto. Peso por severidad
  // (crítica 25, alta 10, media 4, baja 1) + penalización por tasa de CI
  // bajo 100%. Clamp [0..100]. Permite que la tarjeta use el mismo anillo
  // que IPA/ICSP y lea de un vistazo si hay deuda urgente.
  const codeqlCounts = data?.codeql?.counts;
  const depCounts = data?.dependabot?.counts;
  const alertsTotal = (codeqlCounts?.total ?? 0) + (depCounts?.total ?? 0);
  const critical = (codeqlCounts?.critical ?? 0) + (depCounts?.critical ?? 0);
  const high = (codeqlCounts?.high ?? 0) + (depCounts?.high ?? 0);
  const medium = (codeqlCounts?.medium ?? 0) + (depCounts?.medium ?? 0);
  const low = (codeqlCounts?.low ?? 0) + (depCounts?.low ?? 0);
  const workflowRate = data?.workflow?.successRate;

  // Score por niveles, no lineal: 100 si no hay nada; cada severidad
  // tiene un tope de penalización para que una dimensión sola no coma
  // todo el puntaje. Bajas y notas son informativas: no restan.
  const score = !data?.configured ? null : Math.max(0, Math.min(100, Math.round(
    100
    - Math.min(40, critical * 12)
    - Math.min(25, high * 3)
    - Math.min(15, Math.max(0, medium - 5) * 1)
    - (workflowRate !== null && workflowRate !== undefined ? (1 - workflowRate) * 20 : 0),
  )));

  // Nivel y badge expresan el estado de SALUD del código: 100 = salud
  // excelente (sin alertas), menos = problemas detectados proporcionales
  // a la severidad máxima.
  const level = !data?.configured ? null
    : critical > 0 ? 'SALUD CRÍTICA'
    : high > 0 ? 'SALUD BAJA'
    : medium > 0 ? 'SALUD PARCIAL'
    : alertsTotal > 0 ? 'SALUD BUENA'
    : 'SALUD EXCELENTE';
  const badge = loading ? 'Consultando' : level ? `${level} · ${alertsTotal} alerta${alertsTotal === 1 ? '' : 's'}` : 'Sin evaluación';

  // Headline cliente-friendly: explica qué significa el estado del código
  // y qué debe hacer el analista para mejorarlo. Sin citar números (ya
  // están en los contadores debajo).
  const headline = !data?.configured ? 'Pendiente de configuración.'
    : critical > 0 ? 'El escáner encontró vulnerabilidades críticas que pueden ser explotadas. Prioriza arreglarlas esta semana antes de desplegar nuevos cambios.'
    : high > 0 ? 'Hay problemas de alto impacto en el código o en sus dependencias. Asigna un analista para revisarlos durante esta semana y evitar incidentes en producción.'
    : medium > 0 ? 'Mejoras de calidad o seguridad sin urgencia inmediata. Agéndalas para el próximo sprint junto con el refactor regular del equipo.'
    : alertsTotal > 0 ? 'Solo quedan recomendaciones menores de estilo o rendimiento. Atiéndelas cuando toques el archivo correspondiente.'
    : 'El escáner no detectó vulnerabilidades ni dependencias inseguras. Mantén las actualizaciones automáticas de Dependabot activas.';

  const dims = data?.configured && alertsTotal > 0 ? ([
    { key: 'critical', label: 'Alertas críticas', count: critical },
    { key: 'high', label: 'Alertas altas', count: high },
    { key: 'medium', label: 'Alertas medias', count: medium },
    { key: 'low', label: 'Alertas bajas', count: low },
  ] as const).filter(d => d.count > 0) : [];

  return <EvaluationCard index="05" title="Salud del código" badge={badge}>
    {loading ? <p className="quality-message" role="status">Consultando GitHub…</p>
      : error ? <p className="quality-message muted">{error}</p>
      : !data ? null
      : !data.configured ? <p className="quality-message muted">{data.message ?? 'Configura AUTOQA_GITHUB_TOKEN y AUTOQA_GITHUB_REPO para ver la salud del código.'}</p>
      : <div className="quality-evaluation__body">
        <div className="quality-score-summary"><Score label="Estado de salud del código" value={score} /><div>
          <h3>{headline}</h3>
          <p>{alertsTotal} alerta{alertsTotal === 1 ? '' : 's'} abierta{alertsTotal === 1 ? '' : 's'}
            {workflowRate !== null && workflowRate !== undefined ? ` · CI: ${Math.round(workflowRate * 100)}% de éxito` : ''}.</p>
          {data.repository && <small><GitBranch size={12} /> {data.repository}</small>}
        </div></div>
        {alertsTotal > 0 && <ol className="quality-dimensions code-health-dims">{dims.map(d => {
          const pct = Math.round(100 * d.count / Math.max(1, alertsTotal));
          return <li key={d.key} className={`code-health-dim is-${d.key}`}>
            <div><strong>{d.label}</strong><span>{pct}% <small>({d.count}/{alertsTotal})</small></span></div>
            <div className="quality-progress"><span style={{ width: `${Math.max(2, pct)}%` }} /></div>
          </li>;
        })}</ol>}
        <Link className="quality-detail-link" href={`/projects/${projectId}/code-health`}>
          {alertsTotal > 0 ? 'Ver detalle de CI, CodeQL y Dependabot →' : 'Ver estado del CI y del escáner →'}
        </Link>
      </div>}
  </EvaluationCard>;
}

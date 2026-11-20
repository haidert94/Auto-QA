'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, GitBranch, ShieldAlert } from 'lucide-react';

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

function AlertsChart({ title, counts, url, top }: { title: string; counts: AlertCounts; url: string | null; top: AlertDetail[] }) {
  // Barra apilada + lista de alertas priorizadas. La tabla por sí sola
  // perdería la lectura rápida de severidad; el chart solo no permite
  // decidir qué atender primero. Juntos dan ambos.
  const palette: Array<[keyof AlertCounts, string, string]> = [
    ['critical', '#991b1b', 'Críticas'], ['high', '#b91c1c', 'Altas'],
    ['medium', '#b45309', 'Medias'], ['low', '#1d4ed8', 'Bajas'],
    ['note', '#4b5563', 'Nota'], ['other', '#6b7280', 'Otras'],
  ];
  const total = counts.total || 1;
  return <div className="code-health-alerts">
    <header><h4>{title}</h4><strong>{counts.total}</strong>
      {url && <a href={url} target="_blank" rel="noreferrer" aria-label={`Ver ${title} en GitHub`}><ExternalLink size={12} /></a>}</header>
    <div className="code-health-bar" role="img" aria-label={palette.map(([k, , label]) => `${label}: ${counts[k]}`).join(', ')}>
      {palette.map(([key, color]) => counts[key] > 0 && <span key={key} style={{ background: color, width: `${(counts[key] / total) * 100}%` }} />)}
    </div>
    <ul className="code-health-legend">{palette.filter(([key]) => counts[key] > 0).map(([key, color, label]) => <li key={key}>
      <span className="code-health-swatch" style={{ background: color }} />{label}<strong>{counts[key]}</strong></li>)}
      {counts.total === 0 && <li className="muted">Sin alertas abiertas.</li>}</ul>
    {top.length > 0 && <ol className="code-health-list">{top.map(alert => <li key={alert.id} className={`code-health-item is-${alert.severity}`}>
      <a href={alert.url} target="_blank" rel="noreferrer">{alert.title}</a>
      <span className={`code-health-badge is-${alert.severity}`}>{severityLabel(alert.severity)}</span>
      {alert.package && <small>{alert.package}</small>}
      {alert.location && <small><code>{alert.location}</code></small>}
    </li>)}
      {counts.total > top.length && <li className="muted">y {counts.total - top.length} más en GitHub.</li>}</ol>}
  </div>;
}

function RunsChart({ runs, successRate }: { runs: WorkflowRun[]; successRate: number | null }) {
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

export function CodeHealthCard({ active }: { active: boolean }) {
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

  return <section className="quality-audits code-health-card" aria-label="Salud del código del repositorio">
    <header><h2><span>05 //</span> Salud del código</h2>
      {data?.repository && <small><GitBranch size={12} />{data.repository}</small>}</header>
    {loading ? <p role="status">Consultando GitHub…</p>
      : error ? <p className="muted">{error}</p>
      : !data ? null
      : !data.configured ? <p className="muted">{data.message ?? 'Configura AUTOQA_GITHUB_TOKEN y AUTOQA_GITHUB_REPO para ver la salud del código.'}</p>
      : <div className="code-health-grid">
        <div className="code-health-widget">
          <header>{data.workflow?.recent.some(r => r.conclusion === 'failure') ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            <h3>CI · {data.workflow?.name ?? '—'}</h3></header>
          {data.workflow ? <RunsChart runs={data.workflow.recent} successRate={data.workflow.successRate} /> : <p className="muted">Sin workflow configurado.</p>}
        </div>
        <div className="code-health-widget">
          <header><ShieldAlert size={14} /><h3>CodeQL</h3></header>
          {data.codeql?.enabled ? <AlertsChart title="Alertas CodeQL" counts={data.codeql.counts} url={data.codeql.url} top={data.codeql.top ?? []} />
            : <p className="muted">CodeQL no habilitado todavía. Activa el workflow <code>codeql.yml</code> en GitHub.</p>}
        </div>
        <div className="code-health-widget">
          <header><ShieldAlert size={14} /><h3>Dependabot</h3></header>
          {data.dependabot?.enabled ? <AlertsChart title="Alertas Dependabot" counts={data.dependabot.counts} url={data.dependabot.url} top={data.dependabot.top ?? []} />
            : <p className="muted">Dependabot no habilitado o sin permisos. Actívalo en Security → Dependabot alerts.</p>}
        </div>
      </div>}
  </section>;
}

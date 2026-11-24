'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, ShieldAlert } from 'lucide-react';
import { AlertsChart, RunsChart } from '../code-health';

import type { CodeHealthResult } from '../../../../../api/src/quality/code-health.service';

export function CodeHealthDetail() {
  const [data, setData] = useState<CodeHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
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
  }, []);

  if (loading) return <p className="muted" role="status">Consultando GitHub…</p>;
  if (error) return <p className="muted">{error}</p>;
  if (!data) return null;
  if (!data.configured) return <p className="muted">{data.message ?? 'Configura AUTOQA_GITHUB_TOKEN y AUTOQA_GITHUB_REPO para ver la salud del código.'}</p>;

  return <>
    {data.repository && <p className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <GitBranch size={13} />{data.repository}
    </p>}
    <div className="code-health-grid">
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
    </div>
  </>;
}

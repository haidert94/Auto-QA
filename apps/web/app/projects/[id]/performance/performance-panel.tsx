'use client';

import { useState, type FormEvent } from 'react';
import type { OrgRole } from '../../../autoqa-server';
import { can } from '../../../permissions';
import { QualityResultsLink } from '../quality-results-link';

type EnvironmentOption = { id: string; type: string | null; baseUrl: string | null };

export function PerformancePanel({ projectId, environments, role }: {
  projectId: string; environments: EnvironmentOption[]; role?: OrgRole;
}) {
  const canCreate = can(role, 'performance.create');
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [url, setUrl] = useState(environments[0]?.baseUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/projects/${projectId}/audits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentId: envId, url }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.detail ? `${payload.message ?? 'Error'} (${payload.issue}: ${payload.detail})` : payload.message ?? 'No se pudo encolar la auditoría.');
        return;
      }
      setNotice('Auditoría encolada.');
    } catch { setError('No se pudo encolar.'); }
    finally { setBusy(false); }
  }

  if (environments.length === 0) {
    return <><p className="muted">Registra al menos un entorno autorizado en modo solo lectura para auditar performance.</p>
      <QualityResultsLink projectId={projectId} /></>;
  }

  return <>
    <p className="muted">
      Audita una URL dentro del alcance autorizado con Lighthouse. Guarda puntajes de performance,
      accesibilidad, buenas prácticas y SEO, más métricas Web Vitals (FCP, LCP, TBT, CLS, SI).
    </p>
    {canCreate && <form onSubmit={queue} className="run-form">
      <label>Entorno<select value={envId} onChange={e => setEnvId(e.target.value)} required>
        {environments.map(env => <option key={env.id} value={env.id}>
          {env.type ?? 'Entorno'} · {env.baseUrl ?? env.id.slice(0, 8)}
        </option>)}
      </select></label>
      <label>URL a auditar
        <input type="url" value={url} onChange={e => setUrl(e.target.value)} required maxLength={2048}
               placeholder="https://app.ejemplo.com/landing"/>
      </label>
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Encolando…' : 'Auditar'}</button>
      </div>
    </form>}
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    <p><QualityResultsLink projectId={projectId} /></p>
  </>;
}

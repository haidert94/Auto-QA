'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { OrgRole } from '../../../autoqa-server';
import { can } from '../../../permissions';

type EnvironmentOption = { id: string; type: string | null; baseUrl: string | null };

type Audit = {
  id: string; url: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  fcpMs: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  siMs: number | null;
};

const statusLabel: Record<Audit['status'], string> = {
  QUEUED: 'En cola', RUNNING: 'En curso', COMPLETED: 'Completada', FAILED: 'Falló', CANCELED: 'Cancelada',
};

function scoreClass(score: number | null): string {
  if (score === null) return 'muted';
  if (score >= 90) return 'success';
  if (score >= 50) return 'warn';
  return 'error';
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

export function PerformancePanel({ projectId, environments, role }: {
  projectId: string; environments: EnvironmentOption[]; role?: OrgRole;
}) {
  const canCreate = can(role, 'performance.create');
  const [audits, setAudits] = useState<Audit[] | null>(null);
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [url, setUrl] = useState(environments[0]?.baseUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const response = await fetch(`/api/projects/${projectId}/audits`, { cache: 'no-store' });
      if (!response.ok) { setError('No se pudo cargar el historial.'); return; }
      setAudits(await response.json());
    } catch { setError('No se pudo cargar el historial.'); }
  }
  useEffect(() => { void load(); }, [projectId]);

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
      await load();
    } catch { setError('No se pudo encolar.'); }
    finally { setBusy(false); }
  }

  if (environments.length === 0) {
    return <p className="muted">Registra al menos un entorno autorizado en modo solo lectura para auditar performance.</p>;
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
        <button type="button" className="secondary" onClick={load}>Actualizar</button>
      </div>
    </form>}
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {audits === null
      ? <p className="muted">Cargando…</p>
      : audits.length === 0
        ? <p className="muted">Sin auditorías aún.</p>
        : <ul className="audit-list">
          {audits.map(audit => <li key={audit.id}>
            <div className="run-head">
              <span className={`badge badge-${audit.status.toLowerCase()}`}>{statusLabel[audit.status]}</span>
              <span className="muted">{formatDate(audit.createdAt)}</span>
              {audit.errorCode && <span className="muted">· {audit.errorCode}</span>}
            </div>
            <p className="audit-url muted">{audit.url}</p>
            {audit.status === 'COMPLETED' && <>
              <div className="audit-scores">
                <div><span className="muted">Performance</span><strong className={scoreClass(audit.performanceScore)}>{audit.performanceScore ?? '—'}</strong></div>
                <div><span className="muted">Accesibilidad</span><strong className={scoreClass(audit.accessibilityScore)}>{audit.accessibilityScore ?? '—'}</strong></div>
                <div><span className="muted">Buenas prácticas</span><strong className={scoreClass(audit.bestPracticesScore)}>{audit.bestPracticesScore ?? '—'}</strong></div>
                <div><span className="muted">SEO</span><strong className={scoreClass(audit.seoScore)}>{audit.seoScore ?? '—'}</strong></div>
              </div>
              <div className="audit-metrics">
                {audit.fcpMs !== null && <span><b>FCP</b> {audit.fcpMs} ms</span>}
                {audit.lcpMs !== null && <span><b>LCP</b> {audit.lcpMs} ms</span>}
                {audit.tbtMs !== null && <span><b>TBT</b> {audit.tbtMs} ms</span>}
                {audit.cls !== null && <span><b>CLS</b> {audit.cls.toFixed(3)}</span>}
                {audit.siMs !== null && <span><b>SI</b> {audit.siMs} ms</span>}
              </div>
              <p>
                <a href={`/api/projects/${projectId}/audits/${audit.id}/report`} download>Descargar reporte JSON</a>
              </p>
            </>}
          </li>)}
        </ul>}
  </>;
}

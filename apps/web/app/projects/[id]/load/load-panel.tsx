'use client';

import { useEffect, useState, type FormEvent } from 'react';

type EnvironmentOption = { id: string; type: string | null; baseUrl: string | null };

type LoadTest = {
  id: string; name: string; url: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  errorCode: string | null;
  stages: Array<{ duration: string; target: number }>;
  startedAt: string | null; completedAt: string | null; createdAt: string;
  totalRequests: number | null;
  reqPerSec: number | null;
  failRate: number | null;
  p50Ms: number | null; p95Ms: number | null; p99Ms: number | null;
  maxVus: number | null; durationSec: number | null;
};

const PROFILES = [
  { label: 'Suave · 10 VUs 2 min', stages: [
    { duration: '30s', target: 5 }, { duration: '1m', target: 10 }, { duration: '30s', target: 0 },
  ]},
  { label: 'Medio · 30 VUs 5 min', stages: [
    { duration: '1m', target: 10 }, { duration: '3m', target: 30 }, { duration: '1m', target: 0 },
  ]},
  { label: 'Intensivo · 100 VUs 10 min', stages: [
    { duration: '2m', target: 20 }, { duration: '2m', target: 50 }, { duration: '5m', target: 100 }, { duration: '1m', target: 0 },
  ]},
];

const statusLabel: Record<LoadTest['status'], string> = {
  QUEUED: 'En cola', RUNNING: 'En curso', COMPLETED: 'Completada', FAILED: 'Falló', CANCELED: 'Cancelada',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

export function LoadPanel({ projectId, environments }: { projectId: string; environments: EnvironmentOption[] }) {
  const [tests, setTests] = useState<LoadTest[] | null>(null);
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [name, setName] = useState('');
  const [url, setUrl] = useState(environments[0]?.baseUrl ?? '');
  const [profileIndex, setProfileIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const response = await fetch(`/api/projects/${projectId}/load-tests`, { cache: 'no-store' });
      if (!response.ok) { setError('No se pudo cargar el historial.'); return; }
      setTests(await response.json());
    } catch { setError('No se pudo cargar el historial.'); }
  }
  useEffect(() => { void load(); }, [projectId]);

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/load-tests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environmentId: envId, name: name.trim(), url,
          stages: PROFILES[profileIndex].stages,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.detail ? `${payload.message ?? 'Error'} (${payload.issue}: ${payload.detail})` : payload.message ?? 'No se pudo encolar la prueba.');
        return;
      }
      setName('');
      await load();
    } catch { setError('No se pudo encolar la prueba.'); }
    finally { setBusy(false); }
  }

  if (environments.length === 0) {
    return <p className="muted">Autoriza al menos un entorno para encolar pruebas de carga.</p>;
  }

  return <>
    <p className="muted">
      Simula tráfico concurrente contra una URL autorizada. Define cuántos usuarios virtuales (VUs) por
      cuánto tiempo y AutoQA mide latencias p50/p95/p99, requests por segundo y tasa de error.
    </p>

    <form onSubmit={queue} className="run-form">
      <label>Nombre<input value={name} onChange={e => setName(e.target.value)} required maxLength={120}
        placeholder="Pico mañana del lunes"/></label>
      <label>Entorno<select value={envId} onChange={e => setEnvId(e.target.value)} required>
        {environments.map(env => <option key={env.id} value={env.id}>
          {env.type ?? 'Entorno'} · {env.baseUrl ?? env.id.slice(0, 8)}
        </option>)}
      </select></label>
      <label>URL a cargar<input type="url" value={url} onChange={e => setUrl(e.target.value)} required maxLength={2048}/></label>
      <label>Perfil<select value={profileIndex} onChange={e => setProfileIndex(Number(e.target.value))}>
        {PROFILES.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
      </select></label>
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Encolando…' : 'Encolar prueba'}</button>
        <button type="button" className="secondary" onClick={load}>Actualizar</button>
      </div>
    </form>

    {error && <p className="error" role="alert">{error}</p>}

    {tests === null
      ? <p className="muted">Cargando…</p>
      : tests.length === 0
        ? <p className="muted">Sin pruebas de carga todavía.</p>
        : <ul className="audit-list">
          {tests.map(t => <li key={t.id}>
            <div className="run-head">
              <span className={`badge badge-${t.status.toLowerCase()}`}>{statusLabel[t.status]}</span>
              <strong>{t.name}</strong>
              <span className="muted">{formatDate(t.createdAt)}</span>
              {t.errorCode && <span className="muted">· {t.errorCode}</span>}
            </div>
            <p className="audit-url muted">{t.url}</p>
            {t.status === 'COMPLETED' && <>
              <div className="audit-scores">
                <div><span className="muted">Requests</span><strong>{t.totalRequests ?? '—'}</strong></div>
                <div><span className="muted">req/s</span><strong>{t.reqPerSec?.toFixed(1) ?? '—'}</strong></div>
                <div><span className="muted">p95</span><strong>{t.p95Ms ?? '—'} ms</strong></div>
                <div><span className="muted">Error rate</span><strong>{t.failRate !== null ? (t.failRate * 100).toFixed(2) + '%' : '—'}</strong></div>
              </div>
              <div className="audit-metrics">
                {t.p50Ms !== null && <span><b>p50</b> {t.p50Ms} ms</span>}
                {t.p99Ms !== null && <span><b>p99</b> {t.p99Ms} ms</span>}
                {t.maxVus !== null && <span><b>VUs máx</b> {t.maxVus}</span>}
                {t.durationSec !== null && <span><b>Duración</b> {t.durationSec} s</span>}
              </div>
              <p><a href={`/api/projects/${projectId}/load-tests/${t.id}/summary`} download>Descargar summary k6</a></p>
            </>}
          </li>)}
        </ul>}
  </>;
}

'use client';

import { useState } from 'react';

type Page = { url: string; httpStatus: number | null };

type DiffPayload = {
  previous: { id: string; finishedAt: string | null } | null;
  current: { id: string; finishedAt: string | null };
  diff: {
    added: Page[];
    removed: Page[];
    statusChanged: Array<{ url: string; from: number | null; to: number | null }>;
  };
};

export function DiffPanel({ projectId, explorationId }: { projectId: string; explorationId: string }) {
  const [data, setData] = useState<DiffPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/explorations/${explorationId}/diff`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) { setError('No se pudo cargar el diff.'); return; }
      setData(payload);
    } catch { setError('No se pudo cargar el diff.'); }
    finally { setBusy(false); }
  }

  return <section className="diff-panel">
    <header>
      <strong>Comparación con exploración anterior</strong>
      {data
        ? <button type="button" className="secondary" onClick={() => setData(null)}>Cerrar</button>
        : <button type="button" className="secondary" onClick={load} disabled={busy}>
          {busy ? 'Cargando…' : 'Comparar'}
        </button>}
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    {data && (!data.previous
      ? <p className="muted">No hay exploración completada anterior para la misma URL y entorno.</p>
      : <>
        <p className="muted">
          Anterior: {data.previous.finishedAt ? new Date(data.previous.finishedAt).toLocaleString('es-CO') : '—'}
        </p>
        <h3>URLs nuevas ({data.diff.added.length})</h3>
        {data.diff.added.length === 0
          ? <p className="muted">Ninguna.</p>
          : <ul className="diff-urls added">
            {data.diff.added.map(p => <li key={p.url}>
              {p.httpStatus !== null && <span className={`badge badge-http badge-http-${Math.floor(p.httpStatus / 100)}`}>{p.httpStatus}</span>}
              <span>{p.url}</span>
            </li>)}
          </ul>}
        <h3>URLs desaparecidas ({data.diff.removed.length})</h3>
        {data.diff.removed.length === 0
          ? <p className="muted">Ninguna.</p>
          : <ul className="diff-urls removed">
            {data.diff.removed.map(p => <li key={p.url}>
              {p.httpStatus !== null && <span className={`badge badge-http badge-http-${Math.floor(p.httpStatus / 100)}`}>{p.httpStatus}</span>}
              <span>{p.url}</span>
            </li>)}
          </ul>}
        <h3>Cambios de estado HTTP ({data.diff.statusChanged.length})</h3>
        {data.diff.statusChanged.length === 0
          ? <p className="muted">Ninguno.</p>
          : <ul className="diff-urls">
            {data.diff.statusChanged.map(c => <li key={c.url}>
              <span className="muted">{c.from ?? '—'}</span>
              <span>→</span>
              {c.to !== null && <span className={`badge badge-http badge-http-${Math.floor(c.to / 100)}`}>{c.to}</span>}
              <span>{c.url}</span>
            </li>)}
          </ul>}
      </>)}
  </section>;
}

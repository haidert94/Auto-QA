'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

export type Environment = { id: string; type?: string | null; baseUrl?: string | null };
export type Exploration = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  startUrl: string;
  environmentId: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
};

const statusLabel: Record<Exploration['status'], string> = {
  QUEUED: 'En cola', RUNNING: 'En curso', COMPLETED: 'Completada', FAILED: 'Falló', CANCELED: 'Cancelada',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

export function ExplorationPanel({ projectId, environments }: { projectId: string; environments: Environment[] }) {
  const [items, setItems] = useState<Exploration[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [startUrl, setStartUrl] = useState(environments[0]?.baseUrl ?? '');

  async function load() {
    try {
      const response = await fetch(`/api/projects/${projectId}/explorations`, { cache: 'no-store' });
      if (!response.ok) { setError('No se pudo cargar el historial.'); return; }
      setItems(await response.json());
    } catch { setError('No se pudo cargar el historial.'); }
  }

  useEffect(() => { void load(); }, [projectId]);

  async function queue(event: FormEvent<HTMLFormElement>, force = false) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/projects/${projectId}/explorations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentId: envId, startUrl, force: force || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload.reused) {
        const minutes = payload.reuseWindowMinutes ?? 15;
        const confirmed = confirm(
          `Ya hay una exploración de esta URL de los últimos ${minutes} minutos. ` +
          '¿Forzar una nueva? Si cancelas, abriremos la existente.',
        );
        if (confirmed) {
          await queue(event, true);
          return;
        }
        window.location.href = `/projects/${projectId}/explorations/${payload.explorationId}`;
        return;
      }
      if (!response.ok) {
        setError(payload.detail ? `${payload.message ?? 'Error'} (${payload.issue}: ${payload.detail})` : payload.message ?? 'No se pudo encolar.');
        return;
      }
      setNotice('Exploración encolada.');
      await load();
    } catch { setError('No se pudo encolar la exploración.'); }
    finally { setBusy(false); }
  }

  if (!environments.length) {
    return <section className="exploration-panel">
      <h2>Exploración</h2>
      <p className="muted">Registra al menos un entorno autorizado en modo solo lectura para iniciar una exploración.</p>
    </section>;
  }

  return <section className="exploration-panel">
    <h2>Exploración</h2>
    <p className="muted">Visita páginas del entorno autorizado en modo solo lectura para inventariar URLs y evidencia.</p>
    <form onSubmit={queue} className="exploration-form">
      <label>Entorno<select value={envId} onChange={e => setEnvId(e.target.value)} required>
        {environments.map(env => <option key={env.id} value={env.id}>
          {env.type ?? 'Entorno'} · {env.baseUrl ?? env.id.slice(0, 8)}
        </option>)}
      </select></label>
      <label>URL de inicio<input type="url" value={startUrl} onChange={e => setStartUrl(e.target.value)} required maxLength={2048} placeholder="https://app.ejemplo.com/"/></label>
      <button className="button primary" type="submit" disabled={busy}>{busy ? 'Encolando…' : 'Iniciar exploración'}</button>
    </form>
    {notice && <p role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="exploration-list">
      {items === null
        ? <p className="muted">Cargando…</p>
        : items.length === 0
          ? <p className="muted">Aún no se ha ejecutado ninguna exploración.</p>
          : <ul>
            {items.map(item => <li key={item.id}>
              <Link href={`/projects/${projectId}/explorations/${item.id}`}>
                <span className={`badge badge-${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span>
                <span className="exploration-url">{item.startUrl}</span>
                <span className="exploration-meta">{formatDate(item.queuedAt)}</span>
              </Link>
            </li>)}
          </ul>}
    </div>
  </section>;
}

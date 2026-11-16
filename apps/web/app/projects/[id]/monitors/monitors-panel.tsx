'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

type EnvironmentOption = { id: string; type: string | null; baseUrl: string | null };

type Monitor = {
  id: string; name: string; url: string; active: boolean;
  intervalMinutes: number; timeoutMs: number; notifyEmails: string[];
  lastCheckedAt: string | null; lastStatus: string | null;
  lastLatencyMs: number | null; lastHttpStatus: number | null;
};

function statusBadge(status: string | null, active: boolean) {
  if (!active) return { label: 'Pausado', cls: 'badge-canceled' };
  if (status === 'UP') return { label: 'UP', cls: 'badge-completed' };
  if (status === 'DOWN') return { label: 'DOWN', cls: 'badge-failed' };
  return { label: 'Sin datos', cls: 'badge-queued' };
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

export function MonitorsPanel({ projectId, environments }: { projectId: string; environments: EnvironmentOption[] }) {
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [name, setName] = useState('');
  const [url, setUrl] = useState(environments[0]?.baseUrl ?? '');
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const response = await fetch(`/api/projects/${projectId}/monitors`, { cache: 'no-store' });
      if (!response.ok) { setError('No se pudo cargar los monitores.'); return; }
      setMonitors(await response.json());
    } catch { setError('No se pudo cargar los monitores.'); }
  }
  useEffect(() => { void load(); }, [projectId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const notifyEmails = emails.split(/[,\n]/).map(e => e.trim()).filter(Boolean);
    try {
      const response = await fetch(`/api/projects/${projectId}/monitors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentId: envId, name: name.trim(), url, intervalMinutes, notifyEmails }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.detail ? `${payload.message ?? 'Error'} (${payload.issue}: ${payload.detail})` : payload.message ?? 'No se pudo crear el monitor.');
        return;
      }
      setName(''); setEmails(''); setShowForm(false);
      await load();
    } catch { setError('No se pudo crear el monitor.'); }
    finally { setBusy(false); }
  }

  async function toggle(id: string, active: boolean) {
    await fetch(`/api/projects/${projectId}/monitors/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar este monitor y todo su historial?')) return;
    await fetch(`/api/projects/${projectId}/monitors/${id}`, { method: 'DELETE' });
    await load();
  }

  if (environments.length === 0) {
    return <p className="muted">Autoriza al menos un entorno para configurar monitores.</p>;
  }

  return <>
    <p className="muted">
      Vigilancia continua por HTTP. El worker chequea cada monitor a su intervalo (5 min–24 h),
      guarda cada resultado y envía correo a la lista de alerta cuando cambia de UP ↔ DOWN.
    </p>

    <div className="actions">
      <button type="button" onClick={() => setShowForm(s => !s)}>
        {showForm ? 'Cancelar' : 'Nuevo monitor'}
      </button>
    </div>

    {showForm && <form onSubmit={create} className="scenario-form">
      <label>Nombre<input value={name} onChange={e => setName(e.target.value)} required maxLength={120}
        placeholder="Landing · staging"/></label>
      <label>Entorno<select value={envId} onChange={e => setEnvId(e.target.value)} required>
        {environments.map(env => <option key={env.id} value={env.id}>
          {env.type ?? 'Entorno'} · {env.baseUrl ?? env.id.slice(0, 8)}
        </option>)}
      </select></label>
      <label>URL<input type="url" value={url} onChange={e => setUrl(e.target.value)} required maxLength={2048}/></label>
      <label>Intervalo (minutos, 5–1440)
        <input type="number" min={5} max={1440} value={intervalMinutes} onChange={e => setIntervalMinutes(Number(e.target.value))}/>
      </label>
      <label>Correos de alerta (separados por coma)
        <input value={emails} onChange={e => setEmails(e.target.value)}
          placeholder="qa@empresa.com, dev@empresa.com"/>
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear monitor'}</button>
    </form>}

    {error && <p className="error" role="alert">{error}</p>}

    {monitors === null
      ? <p className="muted">Cargando…</p>
      : monitors.length === 0
        ? <p className="muted">Sin monitores todavía.</p>
        : <ul className="audit-list">
          {monitors.map(m => {
            const b = statusBadge(m.lastStatus, m.active);
            return <li key={m.id}>
              <div className="run-head">
                <span className={`badge ${b.cls}`}>{b.label}</span>
                <strong>{m.name}</strong>
                <span className="muted">· cada {m.intervalMinutes} min</span>
                {m.lastLatencyMs !== null && <span className="muted">· {m.lastLatencyMs} ms</span>}
                <span className="muted">· última {formatDate(m.lastCheckedAt)}</span>
              </div>
              <p className="audit-url muted">{m.url}</p>
              {m.notifyEmails.length > 0 && <p className="muted">
                Alerta a: {m.notifyEmails.join(', ')}
              </p>}
              <div className="actions">
                <Link href={`/projects/${projectId}/monitors/${m.id}`}>Ver historial →</Link>
                <button type="button" className="secondary" onClick={() => toggle(m.id, m.active)}>
                  {m.active ? 'Pausar' : 'Reactivar'}
                </button>
                <button type="button" className="secondary" onClick={() => remove(m.id)}>Eliminar</button>
              </div>
            </li>;
          })}
        </ul>}
  </>;
}

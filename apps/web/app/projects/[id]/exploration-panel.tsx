'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowRight, Compass, Globe2, Play, RefreshCw, Workflow } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Project } from '../onboarding';
import { ProjectHeading } from './project-heading';
import { useExplorationHeader } from './project-tabs';

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
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function Section({ index, title, badge, children }: { index: string; title: string; badge?: string; children: ReactNode }) {
  return <section className="exploration-section" aria-label={title}>
    <header><h2><span>{index} //</span> {title}</h2>{badge && <span className="exploration-badge">{badge}</span>}</header>
    <div className="exploration-section__body">{children}</div>
  </section>;
}

export function ExplorationPanel({ projectId, environments, project }: { projectId: string; environments: Environment[]; project?: Project }) {
  const header = useExplorationHeader();
  const [items, setItems] = useState<Exploration[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [startUrl, setStartUrl] = useState(environments[0]?.baseUrl ?? '');
  const [refresh, setRefresh] = useState(0);

  async function load() {
    try {
      const response = await fetch(`/api/projects/${projectId}/explorations`, { cache: 'no-store' });
      if (!response.ok) { setError('No se pudo cargar el historial.'); return; }
      setItems(await response.json()); setError('');
    } catch { setError('No se pudo cargar el historial.'); }
  }
  useEffect(() => { void load(); }, [projectId, refresh]);

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
        const confirmed = confirm(`Ya hay una exploración de esta URL de los últimos ${minutes} minutos. ¿Forzar una nueva? Si cancelas, abriremos la existente.`);
        if (confirmed) { await queue(event, true); return; }
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

  const headingNode = project && header?.element ? createPortal(
    <ProjectHeading project={project}
      summary="Recorrido autorizado en modo solo lectura sobre los entornos declarados. Cada exploración inventaría URLs, formularios y evidencias sin ejecutar acciones destructivas."
      actions={<button type="button" className="secondary" onClick={() => setRefresh(v => v + 1)} disabled={busy}>
        <RefreshCw size={13} /> Actualizar historial
      </button>} />,
    header.element,
  ) : null;

  if (!environments.length) {
    return <section className="exploration-panel" aria-label="Exploración del producto">
      {headingNode}
      <Section index="01" title="Entorno autorizado requerido">
        <p className="muted">Registra al menos un entorno en modo solo lectura y confirma su autorización en la pestaña <strong>Datos</strong> para iniciar una exploración.</p>
      </Section>
    </section>;
  }

  const activeItems = items ?? [];
  const inProgress = activeItems.filter(item => item.status === 'QUEUED' || item.status === 'RUNNING').length;
  const completed = activeItems.filter(item => item.status === 'COMPLETED').length;

  return <section className="exploration-panel" aria-label="Exploración del producto">
    {headingNode}
    <Section index="01" title="Nueva exploración" badge={environments.length === 1 ? '1 entorno autorizado' : `${environments.length} entornos autorizados`}>
      <p className="muted exploration-lede">Encola un recorrido no destructivo desde una URL raíz. El agente respeta el alcance declarado, pausa ante CAPTCHAs y no envía formularios.</p>
      <form onSubmit={queue} className="exploration-form" aria-label="Encolar exploración">
        <label><span className="exploration-field-label"><Workflow size={12} /> Entorno</span>
          <select value={envId} onChange={e => setEnvId(e.target.value)} required>
            {environments.map(env => <option key={env.id} value={env.id}>
              {env.type ?? 'Entorno'} · {env.baseUrl ?? env.id.slice(0, 8)}
            </option>)}
          </select></label>
        <label><span className="exploration-field-label"><Globe2 size={12} /> URL de inicio</span>
          <input type="url" value={startUrl} onChange={e => setStartUrl(e.target.value)} required maxLength={2048} placeholder="https://app.ejemplo.com/" inputMode="url" /></label>
        <button className="button-like primary" type="submit" disabled={busy}>
          <Play size={14} />{busy ? 'Encolando…' : 'Iniciar exploración'}
        </button>
      </form>
      {notice && <p className="exploration-notice" role="status">{notice}</p>}
      {error && <p className="exploration-notice error" role="alert">{error}</p>}
    </Section>

    <Section index="02" title="Historial de exploraciones" badge={items === null ? 'Consultando' : `${activeItems.length} registros · ${completed} completadas${inProgress ? ` · ${inProgress} en curso` : ''}`}>
      {items === null ? <p className="muted" role="status">Cargando historial…</p>
        : activeItems.length === 0 ? <div className="exploration-empty">
            <Compass size={28} strokeWidth={1.4} aria-hidden="true" />
            <p>Aún no se ha ejecutado ninguna exploración. Al iniciar una desde el formulario anterior, sus páginas, evidencias y hallazgos aparecerán aquí.</p>
          </div>
        : <ul className="exploration-list">
            {activeItems.map(item => <li key={item.id}>
              <Link href={`/projects/${projectId}/explorations/${item.id}`}>
                <span className={`badge badge-${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span>
                <span className="exploration-url" title={item.startUrl}>{item.startUrl}</span>
                <span className="exploration-meta">{formatDate(item.queuedAt)}</span>
                <ArrowRight size={14} className="exploration-chev" aria-hidden="true" />
              </Link>
            </li>)}
          </ul>}
    </Section>
  </section>;
}

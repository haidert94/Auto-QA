'use client';

// Vista opcional del card "Módulos prioritarios" en la pestaña Datos: un
// canvas donde cada módulo aparece como una chip posicionable. Coordenadas
// normalizadas [0..1] para que escale al tamaño del contenedor, con grid
// automática para módulos sin posición guardada.
//
// Esta vista NO afecta pruebas ni análisis — es ayuda visual para el equipo.
// Se persiste en Project.modulesLayout (JSON), un endpoint PUT la actualiza.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { apiProjects, type Project } from '../onboarding';

type Layout = Record<string, { x: number; y: number }>;

// Autoacomoda los módulos sin posición en una grid uniforme para que nunca
// queden amontonados en (0,0). Una vez el usuario los mueva, sus coords
// pasan al layout persistido y esta función ya no las toca.
function gridFallback(modules: string[], layout: Layout): Layout {
  const resolved: Layout = { ...layout };
  const missing = modules.filter(name => !resolved[name]);
  if (!missing.length) return resolved;
  const cols = Math.ceil(Math.sqrt(missing.length));
  missing.forEach((name, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    resolved[name] = {
      x: (col + 0.5) / cols,
      y: 0.2 + (row + 0.5) * (0.6 / Math.ceil(missing.length / cols)),
    };
  });
  return resolved;
}

export function ModulesMapCompact({ modules, layout, onExpand }: {
  modules: string[];
  layout: Layout | null;
  onExpand: () => void;
}) {
  if (!modules.length) return null;
  const resolved = gridFallback(modules, layout ?? {});
  return <button type="button" className="modules-map modules-map--compact" onClick={onExpand}
    aria-label="Ampliar mapa de módulos para editar">
    {modules.map(name => {
      const pos = resolved[name];
      return <span key={name} className="modules-map__chip"
        style={{ left: (pos.x * 100) + '%', top: (pos.y * 100) + '%' }}>{name}</span>;
    })}
    <span className="modules-map__hint">Editar diseño</span>
  </button>;
}

export function ModulesMapDialog({ project, onClose, onSaved }: {
  project: Project;
  onClose: () => void;
  onSaved: (updated: Project) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>(() => gridFallback(project.priorityModules, project.modulesLayout ?? {}));
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);

  function startDrag(name: string, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    setDragging(name);
  }

  function dragMove(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!dragging || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    // Clampeamos a [0..1] para que el server acepte sin rechazar.
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setLayout(current => ({ ...current, [dragging]: { x, y } }));
  }

  function endDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    setDragging(null);
  }

  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      // Solo envío entradas de módulos que siguen existiendo. El sanitizer
      // del backend hace lo mismo pero reducir aquí evita ida innecesaria.
      const filtered: Layout = {};
      for (const name of project.priorityModules) {
        if (layout[name]) filtered[name] = layout[name];
      }
      const response = await fetch(`${apiProjects}/${project.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: project.revision,
          status: project.status,
          name: project.name,
          description: project.description ?? undefined,
          ownerLabel: project.ownerLabel ?? undefined,
          priorityModules: project.priorityModules,
          modulesLayout: filtered,
          environments: project.environments.map(env => ({
            id: env.id, type: env.type ?? undefined, baseUrl: env.baseUrl ?? undefined,
            accessMode: env.accessMode ?? undefined,
            authorizationConfirmed: env.authorizationConfirmed,
            allowedHosts: env.allowedHosts, allowedPaths: env.allowedPaths,
            excludedPaths: env.excludedPaths, prohibitedActions: env.prohibitedActions,
            readOnly: env.readOnly,
          })),
          roles: project.roles.map(role => ({
            name: role.name, description: role.description ?? undefined,
            secretReference: role.secretReference ?? undefined,
            permissions: role.permissions,
          })),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(typeof data.message === 'string' ? data.message
          : Array.isArray(data.message) ? data.message.join('; ')
          : 'No se pudo guardar el diseño.');
        return;
      }
      const updated: Project = await response.json();
      onSaved(updated);
      onClose();
    } catch {
      setError('No se pudo guardar el diseño.');
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="environments-dialog modules-map-dialog"
    aria-labelledby="modules-map-dialog-title"
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <header className="environments-dialog__head">
      <h2 id="modules-map-dialog-title">Diseño de módulos</h2>
      <button type="button" className="secondary" onClick={onClose} disabled={busy} aria-label="Cerrar">×</button>
    </header>
    <div className="environments-dialog__form">
      <p className="muted" style={{ marginTop: 0 }}>
        Arrastra cada módulo para reorganizarlo. Esta vista es informativa — no afecta las pruebas ni el IPA.
      </p>
      <div ref={canvas} className="modules-map modules-map--expanded">
        {project.priorityModules.map(name => {
          const pos = layout[name] ?? { x: 0.5, y: 0.5 };
          return <span key={name}
            className={dragging === name ? 'modules-map__chip modules-map__chip--dragging' : 'modules-map__chip'}
            style={{ left: (pos.x * 100) + '%', top: (pos.y * 100) + '%' }}
            onPointerDown={event => startDrag(name, event)}
            onPointerMove={dragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}>
            {name}
          </span>;
        })}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar diseño'}
        </button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button>
      </div>
    </div>
  </dialog>;
}

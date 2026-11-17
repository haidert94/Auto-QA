'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { environmentTypes, statusLabels, type Project } from '../onboarding';
import { ProjectForm } from '../project-form';
import { IpaHero, type IpaSummary } from './ipa-hero';

// Modo del tab Datos:
// - READY sin editing => resumen con dona IPA + datos readonly + botón Editar.
// - DRAFT o editing   => el ProjectForm editable tal cual.
// Cuando el ProjectForm reporta un save con status READY vía onSaved, salimos
// del modo editing automáticamente para que el usuario vea la dona enseguida.

export function DataTab({ project, ipa }: { project: Project; ipa: IpaSummary | null }) {
  const [editing, setEditing] = useState(project.status !== 'READY');

  // Si el server vuelve a enviar un project con status DRAFT (p.ej. tras un
  // archivado y restauración), nos aseguramos de seguir editables. No forzamos
  // false en READY aquí: eso lo hace el callback de save o la acción del
  // usuario.
  useEffect(() => {
    if (project.status !== 'READY') setEditing(true);
  }, [project.status]);

  if (editing) {
    return (
      <>
        {project.status === 'READY' && (
          <section className="panel" style={{ marginBottom: 16 }}>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              ← Volver a la vista de resumen
            </button>
          </section>
        )}
        <ProjectForm initial={project} onSaved={saved => {
          if (saved.status === 'READY') setEditing(false);
        }} />
      </>
    );
  }

  return (
    <>
      {ipa && (
        <section className="panel ipa-diagnostic">
          <IpaHero ipa={ipa} subtitle="Score estructural calculado al vuelo con readiness.ts." />
          <p style={{ marginTop: 16 }}>
            <Link href={`/projects/${project.id}/ipa`} className="button-like outline">Ver detalle del IPA →</Link>
          </p>
        </section>
      )}

      <section className="panel">
        <header className="projects-panel__head">
          <div>
            <h2 style={{ margin: 0 }}>{project.name}</h2>
            <p className="muted" style={{ margin: 0 }}>{statusLabels[project.status]}</p>
          </div>
          <button type="button" onClick={() => setEditing(true)}>Editar datos</button>
        </header>

        <dl className="wizard-review">
          {project.description && <div><dt>Descripción</dt><dd>{project.description}</dd></div>}
          {project.ownerLabel && <div><dt>Propietario</dt><dd>{project.ownerLabel}</dd></div>}
          <div>
            <dt>Entornos</dt>
            <dd>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {project.environments.map(env => (
                  <li key={env.id}>
                    {env.type ? environmentTypes[env.type] : 'Entorno sin tipo'}
                    {env.baseUrl && <> · <code>{env.baseUrl}</code></>}
                    {env.hasCredentials && <> · <small className="muted">credencial guardada</small></>}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          {project.priorityModules.length > 0 && (
            <div>
              <dt>Módulos prioritarios</dt>
              <dd>{project.priorityModules.join(' · ')}</dd>
            </div>
          )}
        </dl>
      </section>
    </>
  );
}

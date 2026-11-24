'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { environmentTypes, statusLabels, type ProjectSummary } from './onboarding';

const statusBadge: Record<ProjectSummary['status'], string> = {
  DRAFT: 'badge-queued',
  READY: 'badge-completed',
  ARCHIVED: 'badge-canceled',
};

export function ProjectCard({ project, canRemove = true }: { project: ProjectSummary; canRemove?: boolean }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  // El wizard por defecto copia el nombre en ownerLabel. No mostrar el
  // propietario si solo repite el nombre.
  const owner = project.ownerLabel && project.ownerLabel !== project.name
    ? project.ownerLabel : null;
  const primary = project.environments.find(e => e.baseUrl) ?? project.environments[0];

  async function handleRemove() {
    const label = `Vas a eliminar "${project.name}" y sus entornos, roles, documentos, escenarios, código de pruebas y ejecuciones. Esta acción es definitiva.`;
    if (!confirm(label)) return;
    setRemoving(true); setError('');
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(typeof payload.message === 'string' ? payload.message : 'No se pudo eliminar el proyecto.');
        return;
      }
      router.refresh();
    } catch { setError('No se pudo comunicar con la API.'); }
    finally { setRemoving(false); }
  }

  return (
    <article className="project-card">
      <header className="project-card__head">
        <div>
          <h2 className="project-card__title">
            <Link href={`/projects/${project.id}`}>{project.name}</Link>
          </h2>
          {owner && <p className="muted project-card__owner">Propietario · {owner}</p>}
        </div>
        <span className={`badge ${statusBadge[project.status]}`}>{statusLabels[project.status]}</span>
      </header>

      {primary && (
        <p className="project-card__env">
          <span className="muted">{primary.type ? environmentTypes[primary.type] : 'Entorno pendiente'}</span>
          {primary.baseUrl && <code className="project-card__url">{primary.baseUrl}</code>}
        </p>
      )}
      {project.environments.length > 1 && (
        <p className="muted project-card__more">+{project.environments.length - 1} entornos más</p>
      )}

      <footer className="project-card__actions">
        <Link href={`/projects/${project.id}`} className="button-like outline">Abrir</Link>
        {canRemove && <button type="button" className="outline project-card__remove" onClick={handleRemove} disabled={removing}>
          {removing ? 'Eliminando…' : 'Eliminar'}
        </button>}
      </footer>
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

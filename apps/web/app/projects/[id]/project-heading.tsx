'use client';

import Link from 'next/link';
import { ArrowRight, ChevronRight, Download } from 'lucide-react';
import { statusLabels, type Project } from '../onboarding';
import type { ReactNode } from 'react';

export function ProjectHeading({ project, actions, summary }: { project: Project; actions?: ReactNode; summary?: string }) {
  function exportSpecification() {
    // Explicit projection: omit credentials, credential identities and vault references.
    const specification = {
      id: project.id, name: project.name, description: project.description, status: project.status,
      priorityModules: project.priorityModules,
      environments: project.environments.map(environment => ({
        type: environment.type, authorizationConfirmed: environment.authorizationConfirmed,
        allowedHosts: environment.allowedHosts, allowedPaths: environment.allowedPaths,
        excludedPaths: environment.excludedPaths, prohibitedActions: environment.prohibitedActions,
        readOnly: environment.readOnly,
      })),
      roles: project.roles.map(role => ({ name: role.name, description: role.description, permissions: role.permissions })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(specification, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'autoqa-especificacion.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <div className="project-breadcrumb-row">
      <nav className="project-breadcrumb" aria-label="Ruta del proyecto">
        <Link href="/projects">Proyectos</Link><ChevronRight size={11} /><span>{project.name}</span>
      </nav><span className="project-revision">Revisión {project.revision}</span>
    </div>
    <header className={`project-heading${actions ? ' project-heading--scenarios' : ''}`}>
      <div className="project-heading__identity">
        <div className="project-heading__title"><h1>{project.name}</h1><span className="project-id">ID: {project.id}</span></div>
        <span className={`project-status project-status--${project.status.toLowerCase()}`}><i aria-hidden="true" />{statusLabels[project.status]}</span>
        <p>{summary ?? project.description ?? 'Agrega una descripción para documentar el propósito de la aplicación.'}</p>
      </div>
      <div className="project-heading__actions">
        {actions ?? <>
        <button type="button" className="secondary" onClick={exportSpecification}><Download size={14} /> Exportar especificación</button>
        <a className="button-like" href="#automatizacion">Automatizar con IA <ArrowRight size={15} /></a>
        </>}
      </div>
    </header>
  </>;
}

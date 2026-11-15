import { accountFetch } from '../autoqa-server';
import Link from 'next/link';
import { environmentTypes, statusLabels, type ProjectSummary } from './onboarding';

export const dynamic = 'force-dynamic';

export default async function Projects() {
  let projects: ProjectSummary[] = [];
  let error = '';
  try {
    const response = await accountFetch('/projects');
    if (!response.ok) throw new Error('API no disponible');
    projects = await response.json();
  } catch {
    error = 'No se pudo consultar la API. Comprueba que NestJS y PostgreSQL estén ejecutándose.';
  }
  return (
    <section className="panel">
      <h1>Proyectos</h1>
      <p><Link href="/projects/new">Registrar aplicación</Link></p>
      {error && <p className="error" role="alert">{error}</p>}
      {!projects.length && !error && <p>Aún no hay proyectos.</p>}
      {projects.map(project => (
        <article className="item" key={project.id}>
          <h2><Link href={`/projects/${project.id}`}>{project.name}</Link></h2>
          <p className="muted">{statusLabels[project.status]}{project.ownerLabel && ` · ${project.ownerLabel}`}</p>
          {project.environments.length > 0 && (
            <ul>
              {project.environments.map(environment => (
                <li key={environment.id}>
                  {environment.type ? environmentTypes[environment.type] : 'Entorno pendiente'}
                  {environment.baseUrl && ` · ${environment.baseUrl}`}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}

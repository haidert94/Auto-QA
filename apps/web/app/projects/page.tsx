import Link from 'next/link';
import { accountFetch } from '../autoqa-server';
import { type ProjectSummary } from './onboarding';
import { ProjectCard } from './project-card';

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

  const visible = projects.filter(p => p.status !== 'ARCHIVED');

  return (
    <section className="panel projects-panel">
      <header className="projects-panel__head">
        <div>
          <h1>Proyectos</h1>
          <p className="muted">
            {visible.length === 0 ? 'Aún no has registrado aplicaciones.'
              : `${visible.length} ${visible.length === 1 ? 'aplicación registrada' : 'aplicaciones registradas'}.`}
          </p>
        </div>
        <Link href="/projects/new" className="button-like">Registrar aplicación</Link>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      {visible.length === 0 && !error && (
        <div className="projects-empty">
          <h2>Comienza registrando una aplicación</h2>
          <p className="muted">Declara el alcance, los dominios permitidos y la autorización para empezar a analizar sus requisitos.</p>
          <Link href="/projects/new" className="button-like">Registrar aplicación</Link>
        </div>
      )}

      {visible.length > 0 && (
        <div className="projects-grid">
          {visible.map(project => <ProjectCard key={project.id} project={project}/>)}
        </div>
      )}
    </section>
  );
}

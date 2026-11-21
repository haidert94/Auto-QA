import Link from 'next/link';
import { accountFetch, requireAccount } from '../autoqa-server';
import { AppPageHeading } from '../app-page-heading';
import { can } from '../permissions';
import { type ProjectSummary } from './onboarding';
import { ProjectCard } from './project-card';

export const dynamic = 'force-dynamic';

export default async function Projects() {
  const account = await requireAccount().catch(() => null);
  let projects: ProjectSummary[] = [];
  let error = '';
  try {
    const response = await accountFetch('/projects');
    if (!response.ok) throw new Error('API no disponible');
    projects = await response.json();
  } catch {
    error = 'No se pudo consultar la API. Comprueba que NestJS y PostgreSQL estén ejecutándose.';
  }

  const canCreate = can(account?.role, 'project.create');
  const canRemove = can(account?.role, 'project.delete');

  const visible = projects.filter(p => p.status !== 'ARCHIVED');

  const summary = visible.length === 0 ? 'Aún no has registrado aplicaciones.'
    : `${visible.length} ${visible.length === 1 ? 'aplicación registrada' : 'aplicaciones registradas'}.`;

  return (
    <>
    <AppPageHeading
      crumbs={[{ label: account?.organization.name ?? 'AutoQA' }, { label: 'Proyectos' }]}
      title="Proyectos"
      summary={summary}
      aside={visible.length > 0 ? `${visible.length} activos` : undefined}
      actions={canCreate ? <Link href="/projects/new" className="button-like">Registrar aplicación</Link> : undefined}
    />
    <section className="app-section projects-panel">
      <header><h2><span>01 //</span> APLICACIONES REGISTRADAS</h2>
        {canCreate && <Link href="/projects/new" className="app-section__link">Registrar aplicación →</Link>}</header>
      {error && <p className="error" role="alert">{error}</p>}

      {visible.length === 0 && !error && (
        <div className="projects-empty">
          <h2>{canCreate ? 'Comienza registrando una aplicación' : 'Aún no tienes proyectos asignados'}</h2>
          <p className="muted">
            {canCreate
              ? 'Declara el alcance, los dominios permitidos y la autorización para empezar a analizar sus requisitos.'
              : 'Pídele a un ADMIN u OWNER de la organización que te asigne proyectos para empezar a trabajar.'}
          </p>
          {canCreate && <Link href="/projects/new" className="button-like">Registrar aplicación</Link>}
        </div>
      )}

      {visible.length > 0 && (
        <div className="projects-grid">
          {visible.map(project => <ProjectCard key={project.id} project={project} canRemove={canRemove}/>)}
        </div>
      )}
    </section>
    </>
  );
}

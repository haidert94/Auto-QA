import Link from 'next/link';
import { accountFetch, requireAccount } from '../autoqa-server';
import { AppPageHeading } from '../app-page-heading';
import { can } from '../permissions';
import { type ProjectSummary } from './onboarding';
import { ProjectCard } from './project-card';

export const dynamic = 'force-dynamic';

type StatusFilter = 'all' | 'ready' | 'in-progress' | 'draft';
const FILTER_META: Record<StatusFilter, { label: string; summary: string }> = {
  all: { label: 'Todos', summary: 'Todas las aplicaciones registradas no archivadas.' },
  ready: { label: 'Listos', summary: 'Proyectos con al menos un snapshot ICSP guardado (versión congelada en el historial).' },
  'in-progress': { label: 'En proceso', summary: 'Proyectos con pruebas ejecutadas pero sin snapshot de versión aún.' },
  draft: { label: 'Borrador', summary: 'Proyectos sin ejecuciones completadas todavía.' },
};

export default async function Projects({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const params = (await searchParams) ?? {};
  const status: StatusFilter = params.status === 'ready' || params.status === 'in-progress' || params.status === 'draft' ? params.status : 'all';
  const meta = FILTER_META[status];

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

  const notArchived = projects.filter(p => p.status !== 'ARCHIVED');
  const visible = notArchived.filter(p => {
    const snapshots = p.icspSnapshots ?? 0;
    const runs = p.completedRuns ?? 0;
    if (status === 'ready') return snapshots > 0;
    if (status === 'in-progress') return runs > 0 && snapshots === 0;
    if (status === 'draft') return runs === 0 && snapshots === 0;
    return true;
  });

  const summary = visible.length === 0 ? `No hay proyectos en la categoría "${meta.label}".`
    : `${visible.length} ${visible.length === 1 ? 'aplicación' : 'aplicaciones'} · ${meta.summary}`;

  return (
    <>
    <AppPageHeading
      back={status !== 'all' ? { href: '/dashboard' } : undefined}
      crumbs={[{ label: account?.organization.name ?? 'AutoQA' }, { href: '/projects', label: 'Proyectos' }, ...(status !== 'all' ? [{ label: meta.label }] : [])]}
      title={status === 'all' ? 'Proyectos' : `Proyectos · ${meta.label}`}
      summary={summary}
      aside={visible.length > 0 ? `${visible.length} de ${notArchived.length}` : undefined}
      actions={canCreate ? <Link href="/projects/new" className="button-like">Registrar aplicación</Link> : undefined}
    />
    <nav className="projects-filter-tabs" aria-label="Filtrar proyectos por estado">
      {(['all', 'ready', 'in-progress', 'draft'] as StatusFilter[]).map(key => <Link key={key}
        href={key === 'all' ? '/projects' : `/projects?status=${key}`}
        aria-current={status === key ? 'page' : undefined}
        className={status === key ? 'is-active' : ''}>
        {FILTER_META[key].label}
      </Link>)}
    </nav>
    <section className="app-section projects-panel">
      <header><h2><span>01 //</span> APLICACIONES ({visible.length})</h2>
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

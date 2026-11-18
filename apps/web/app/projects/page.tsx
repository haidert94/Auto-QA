import Link from 'next/link';
import { accountFetch, requireAccount } from '../autoqa-server';
import { type ProjectSummary } from './onboarding';
import { ProjectCard } from './project-card';

type OrgRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
const ROLE_RANK: Record<OrgRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };

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

  // Rol del usuario en su organización, para ocultar acciones destructivas o de
  // creación cuando no alcanza. El servidor sigue bloqueando por rol — esto es UX.
  let myRole: OrgRole = 'VIEWER';
  try {
    const account = await requireAccount();
    const membersResponse = await accountFetch('/commerce/members');
    if (membersResponse.ok) {
      const data: { members: { user: { email: string }; role: OrgRole }[] } = await membersResponse.json();
      const me = data.members.find(m => m.user.email.toLowerCase() === account.email.toLowerCase());
      if (me) myRole = me.role;
    }
  } catch {}
  const canCreate = ROLE_RANK[myRole] >= ROLE_RANK.ADMIN;
  const canRemove = ROLE_RANK[myRole] >= ROLE_RANK.ADMIN;

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
        {canCreate && <Link href="/projects/new" className="button-like">Registrar aplicación</Link>}
      </header>

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
  );
}

import { accountFetch, requireAccount } from '../../autoqa-server';
import { AppPageHeading } from '../../app-page-heading';
import { MembersPanel } from './members-panel';

type OrgRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

type ProjectRef = { id: string; name: string };
type Member = {
  userId: string;
  role: OrgRole;
  joinedAt: string;
  user: { name: string | null; email: string };
  projects: ProjectRef[];
};
type Invite = {
  id: string; email: string; name: string | null; role: OrgRole; createdAt: string; expiresAt: string;
  invitedBy: { name: string | null; email: string };
};

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const account = await requireAccount();
  const response = await accountFetch('/commerce/members');
  if (!response.ok) {
    return <>
      <AppPageHeading
        crumbs={[{ label: account.organization.name }, { label: 'Miembros' }]}
        title="Miembros"
        summary="Hubo un problema al cargar la lista de miembros."
      />
      <section className="panel">
        <p className="error" role="alert">No se pudieron cargar los miembros.</p>
      </section>
    </>;
  }
  const data: { members: Member[]; invites: Invite[]; orgProjects: ProjectRef[] } = await response.json();
  const myMember = data.members.find(m => m.user.email.toLowerCase() === account.email.toLowerCase());
  const myRole: OrgRole = myMember?.role ?? 'VIEWER';

  return <>
    <AppPageHeading
      crumbs={[{ label: account.organization.name }, { label: 'Miembros' }]}
      title={`Miembros de ${account.organization.name}`}
      badge={{ label: `Tu rol · ${myRole}`, tone: 'ready' }}
      summary="Invita personas, asigna proyectos y controla roles OWNER/ADMIN/EDITOR/VIEWER."
      aside={`${data.members.length} activos · ${data.invites.length} invitaciones`}
    />
    <section className="app-section members-panel">
      <header><h2><span>01 //</span> EQUIPO E INVITACIONES</h2></header>
      <MembersPanel
        initial={data}
        currentUserId={myMember?.userId ?? ''}
        myRole={myRole}
      />
    </section>
  </>;
}

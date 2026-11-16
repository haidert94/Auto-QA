import Link from 'next/link';
import { accountFetch, requireAccount } from '../../autoqa-server';
import { MembersPanel } from './members-panel';

type OrgRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

type Member = { userId: string; role: OrgRole; joinedAt: string; user: { name: string | null; email: string } };
type Invite = {
  id: string; email: string; role: OrgRole; createdAt: string; expiresAt: string;
  invitedBy: { name: string | null; email: string };
};

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const account = await requireAccount();
  const response = await accountFetch('/commerce/members');
  if (!response.ok) {
    return <section className="panel">
      <p><Link href="/projects">← Volver</Link></p>
      <p className="error" role="alert">No se pudieron cargar los miembros.</p>
    </section>;
  }
  const data: { members: Member[]; invites: Invite[] } = await response.json();
  const myMember = data.members.find(m => m.user.email.toLowerCase() === account.email.toLowerCase());
  const myRole: OrgRole = myMember?.role ?? 'VIEWER';

  return <section className="panel members-panel">
    <p><Link href="/projects">← Volver a proyectos</Link></p>
    <header>
      <h1>Miembros de {account.organization.name}</h1>
      <p className="muted">Tu rol en esta organización: <strong>{myRole}</strong>.</p>
    </header>
    <MembersPanel
      initial={data}
      currentUserId={myMember?.userId ?? ''}
      myRole={myRole}
    />
  </section>;
}

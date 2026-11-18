import Link from 'next/link';
import { accountFetch, sessionToken } from '../../autoqa-server';
import { AcceptButton } from './accept-button';
import { ClaimForm } from './claim-form';

type OrgRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

type Invite = {
  email: string;
  name: string | null;
  role: OrgRole;
  expiresAt: string;
  hasAccount: boolean;
  organization: { name: string };
  invitedBy: { name: string | null; email: string };
};

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <section className="panel">
      <h1>Invitación no válida</h1>
      <p className="muted">El enlace está incompleto o no existe. Pide a tu administrador uno nuevo.</p>
    </section>;
  }

  let response: Response | undefined;
  try { response = await accountFetch('/commerce/members/invite/' + token, {}, { public: true }); } catch {}
  if (!response?.ok) {
    return <section className="panel">
      <h1>Invitación no disponible</h1>
      <p className="muted">La invitación venció o ya se usó. Pide una nueva a tu administrador.</p>
    </section>;
  }
  const invite: Invite = await response.json();

  // ¿Está el usuario firmado? Si sí, ¿con qué correo?
  const token_ = await sessionToken();
  let currentEmail: string | null = null;
  if (token_) {
    try {
      const me = await accountFetch('/commerce/me');
      if (me.ok) currentEmail = (await me.json()).email;
    } catch {}
  }

  const matches = currentEmail && currentEmail.toLowerCase() === invite.email.toLowerCase();
  return <section className="panel invite-panel">
    <h1>Invitación a {invite.organization.name}</h1>
    <p className="muted">
      {invite.name ? <>Hola <strong>{invite.name}</strong>. </> : null}
      Te invita <strong>{invite.invitedBy.name ?? invite.invitedBy.email}</strong> con el rol <strong>{invite.role}</strong>.
      Dirigida a <strong>{invite.email}</strong>. Vence el {new Date(invite.expiresAt).toLocaleDateString('es-CO')}.
    </p>

    {!currentEmail && invite.hasAccount && <div className="invite-cta">
      <p>Ya existe una cuenta con <strong>{invite.email}</strong>. Inicia sesión para aceptar.</p>
      <p><Link href="/login" className="button-like">Iniciar sesión</Link></p>
    </div>}

    {!currentEmail && !invite.hasAccount && <ClaimForm
      token={token}
      email={invite.email}
      name={invite.name}
    />}

    {currentEmail && !matches && <div className="invite-cta">
      <p className="error">
        Estás firmado como <strong>{currentEmail}</strong>, pero la invitación es para <strong>{invite.email}</strong>.
      </p>
      <p>
        <Link href="/logout">Cerrar sesión</Link> e inicia sesión con el correo correcto.
      </p>
    </div>}

    {currentEmail && matches && <AcceptButton token={token} />}
  </section>;
}

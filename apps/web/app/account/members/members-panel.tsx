'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

type OrgRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

type Member = { userId: string; role: OrgRole; joinedAt: string; user: { name: string | null; email: string } };
type Invite = {
  id: string; email: string; role: OrgRole; createdAt: string; expiresAt: string;
  invitedBy: { name: string | null; email: string };
};

const RANK: Record<OrgRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };

export function MembersPanel({ initial, currentUserId, myRole }: {
  initial: { members: Member[]; invites: Invite[] };
  currentUserId: string;
  myRole: OrgRole;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('VIEWER');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canInvite = RANK[myRole] >= RANK.ADMIN;
  const canChangeRole = myRole === 'OWNER';
  const canRemove = RANK[myRole] >= RANK.ADMIN;

  async function reload() {
    const response = await fetch('/api/commerce/members', { cache: 'no-store' });
    if (response.ok) setData(await response.json());
  }

  async function run<T>(fn: () => Promise<Response>, successMsg: string): Promise<void> {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fn();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'La operación falló.'); return; }
      setNotice(successMsg);
      await reload();
      router.refresh();
    } catch { setError('La operación falló.'); }
    finally { setBusy(false); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(() => fetch('/api/commerce/members/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    }), 'Invitación enviada.');
    setInviteEmail('');
  }

  async function revokeInvite(id: string) {
    if (!confirm('¿Revocar esta invitación?')) return;
    await run(() => fetch('/api/commerce/members/invites/' + id, { method: 'DELETE' }), 'Invitación revocada.');
  }

  async function removeMember(userId: string, email: string) {
    if (!confirm('¿Remover a ' + email + ' de la organización?')) return;
    await run(() => fetch('/api/commerce/members/' + userId, { method: 'DELETE' }), 'Miembro removido.');
  }

  async function changeRole(userId: string, role: OrgRole) {
    await run(() => fetch('/api/commerce/members/' + userId + '/role', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }), 'Rol actualizado.');
  }

  return <>
    {canInvite && <section className="members-section">
      <h2>Invitar</h2>
      <form onSubmit={invite} className="members-invite">
        <label>Correo
          <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required maxLength={254}/>
        </label>
        <label>Rol
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value as OrgRole)}>
            <option value="VIEWER">VIEWER — lectura</option>
            <option value="EDITOR">EDITOR — edición</option>
            <option value="ADMIN">ADMIN — gestión</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar invitación'}</button>
      </form>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>}

    <section className="members-section">
      <h2>Miembros ({data.members.length})</h2>
      <table className="members-table">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Desde</th><th></th></tr></thead>
        <tbody>
          {data.members.map(member => <tr key={member.userId}>
            <td>{member.user.name ?? '—'}{member.userId === currentUserId && <em className="muted"> (tú)</em>}</td>
            <td>{member.user.email}</td>
            <td>
              {canChangeRole && member.userId !== currentUserId
                ? <select value={member.role} onChange={e => changeRole(member.userId, e.target.value as OrgRole)} disabled={busy}>
                  <option value="OWNER">OWNER</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="EDITOR">EDITOR</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
                : <span className={`badge badge-role-${member.role.toLowerCase()}`}>{member.role}</span>}
            </td>
            <td className="muted">{new Date(member.joinedAt).toLocaleDateString('es-CO')}</td>
            <td>
              {canRemove && member.userId !== currentUserId && <button type="button" className="secondary"
                onClick={() => removeMember(member.userId, member.user.email)} disabled={busy}>Remover</button>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </section>

    {data.invites.length > 0 && <section className="members-section">
      <h2>Invitaciones pendientes ({data.invites.length})</h2>
      <table className="members-table">
        <thead><tr><th>Correo</th><th>Rol</th><th>Invitó</th><th>Vence</th><th></th></tr></thead>
        <tbody>
          {data.invites.map(invite => <tr key={invite.id}>
            <td>{invite.email}</td>
            <td><span className={`badge badge-role-${invite.role.toLowerCase()}`}>{invite.role}</span></td>
            <td className="muted">{invite.invitedBy.name ?? invite.invitedBy.email}</td>
            <td className="muted">{new Date(invite.expiresAt).toLocaleDateString('es-CO')}</td>
            <td>{canInvite && <button type="button" className="secondary"
              onClick={() => revokeInvite(invite.id)} disabled={busy}>Revocar</button>}</td>
          </tr>)}
        </tbody>
      </table>
    </section>}
  </>;
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

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

const RANK: Record<OrgRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };

export function MembersPanel({ initial, currentUserId, myRole }: {
  initial: { members: Member[]; invites: Invite[]; orgProjects: ProjectRef[] };
  currentUserId: string;
  myRole: OrgRole;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('VIEWER');
  const [inviteProjectIds, setInviteProjectIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const needsInviteProjects = inviteRole === 'EDITOR' || inviteRole === 'VIEWER';

  function toggleInviteProject(id: string) {
    setInviteProjectIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    const projectIds = needsInviteProjects ? [...inviteProjectIds] : [];
    const payload: { email: string; name?: string; role: OrgRole; projectIds: string[] } = {
      email: inviteEmail.trim(),
      role: inviteRole,
      projectIds,
    };
    const fullName = [inviteName.trim(), inviteLastName.trim()].filter(Boolean).join(' ');
    if (fullName) payload.name = fullName;
    await run(() => fetch('/api/commerce/members/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), 'Invitación enviada.');
    setInviteEmail('');
    setInviteName('');
    setInviteLastName('');
    setInviteProjectIds(new Set());
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

  async function saveProjects(userId: string, projectIds: string[]) {
    await run(() => fetch('/api/commerce/members/' + userId + '/projects', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectIds }),
    }), 'Proyectos asignados actualizados.');
  }

  return <>
    {canInvite && <section className="members-section">
      <h2>Invitar</h2>
      <form onSubmit={invite} className="members-invite-form">
        <div className="members-invite-fields">
          <label>Nombre
            <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)}
              maxLength={60} placeholder="Ej. Sara" autoComplete="given-name"/>
          </label>
          <label>Apellido
            <input type="text" value={inviteLastName} onChange={e => setInviteLastName(e.target.value)}
              maxLength={60} placeholder="Ej. Monroy" autoComplete="family-name"/>
          </label>
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
        </div>
        {needsInviteProjects && data.orgProjects.length > 0 && <fieldset className="members-invite-projects">
          <legend>Proyectos asignados al aceptar ({inviteProjectIds.size} de {data.orgProjects.length})</legend>
          <p className="muted"><small>
            El invitado solo verá estos proyectos al entrar. Puedes dejarlos sin seleccionar y asignarlos
            después desde la tabla de miembros.
          </small></p>
          <div className="members-project-toggle">
            <button type="button" className="secondary" disabled={busy}
              onClick={() => setInviteProjectIds(
                inviteProjectIds.size === data.orgProjects.length
                  ? new Set()
                  : new Set(data.orgProjects.map(p => p.id))
              )}>
              {inviteProjectIds.size === data.orgProjects.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </button>
          </div>
          <ul className="members-project-list">
            {data.orgProjects.map(project => (
              <li key={project.id}>
                <label>
                  <input type="checkbox" checked={inviteProjectIds.has(project.id)}
                    onChange={() => toggleInviteProject(project.id)} disabled={busy}/>
                  <span>{project.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>}
        {needsInviteProjects && data.orgProjects.length === 0 && <p className="muted"><small>
          Aún no hay proyectos en la organización. El invitado podrá aceptar y lo asignas después.
        </small></p>}
        <button type="submit" disabled={busy} className="members-invite-submit">{busy ? 'Enviando…' : 'Enviar invitación'}</button>
      </form>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>}

    <section className="members-section">
      <h2>Miembros ({data.members.length})</h2>
      <p className="muted"><small>
        OWNER y ADMIN ven todos los proyectos de la organización automáticamente. A EDITOR y VIEWER se les
        asignan los proyectos a los que pueden acceder; sin asignaciones, solo ven proyectos que ellos mismos
        crearon.
      </small></p>
      <table className="members-table">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Proyectos</th><th>Desde</th><th></th></tr></thead>
        <tbody>
          {data.members.map(member => {
            const needsAssignment = member.role === 'EDITOR' || member.role === 'VIEWER';
            return <tr key={member.userId}>
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
              <td>
                {!needsAssignment
                  ? <span className="muted"><small>todos</small></span>
                  : canRemove
                    ? <ProjectAssignmentEditor
                        member={member}
                        orgProjects={data.orgProjects}
                        busy={busy}
                        onSave={ids => saveProjects(member.userId, ids)} />
                    : <span className="muted"><small>{member.projects.length} asignado(s)</small></span>}
              </td>
              <td className="muted">{new Date(member.joinedAt).toLocaleDateString('es-CO')}</td>
              <td>
                {canRemove && member.userId !== currentUserId && <button type="button" className="secondary"
                  onClick={() => removeMember(member.userId, member.user.email)} disabled={busy}>Remover</button>}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </section>

    {canInvite && data.orgProjects.length === 0 && <p className="muted"><small>
      Aún no hay proyectos en la organización. Cuando crees tu primer proyecto podrás asignarlo aquí.
    </small></p>}

    {data.invites.length > 0 && <section className="members-section">
      <h2>Invitaciones pendientes ({data.invites.length})</h2>
      <table className="members-table">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Invitó</th><th>Vence</th><th></th></tr></thead>
        <tbody>
          {data.invites.map(invite => <tr key={invite.id}>
            <td>{invite.name ?? <span className="muted">—</span>}</td>
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

// Editor inline de asignaciones de proyecto para un miembro EDITOR/VIEWER.
// Mantiene estado local hasta que el usuario pulsa Guardar, para evitar un
// PUT por cada checkbox toggled. Cuando se cierra el <details> sin guardar,
// el próximo open resetea al estado persistido.
function ProjectAssignmentEditor({ member, orgProjects, busy, onSave }: {
  member: Member;
  orgProjects: ProjectRef[];
  busy: boolean;
  onSave: (projectIds: string[]) => void;
}) {
  const persisted = new Set(member.projects.map(p => p.id));
  const [selected, setSelected] = useState<Set<string>>(persisted);
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const dirty = selected.size !== persisted.size
    || [...selected].some(id => !persisted.has(id));

  return (
    <details open={open} onToggle={event => {
      const isOpen = (event.currentTarget as HTMLDetailsElement).open;
      setOpen(isOpen);
      // Al reabrir, sincronizar con el estado persistido por si cambió desde fuera.
      if (isOpen) setSelected(new Set(member.projects.map(p => p.id)));
    }}>
      <summary><small>
        {member.projects.length > 0
          ? `${member.projects.length} de ${orgProjects.length} asignado(s)`
          : 'Sin asignaciones · editar'}
      </small></summary>
      {orgProjects.length === 0
        ? <p className="muted"><small>Aún no hay proyectos.</small></p>
        : <>
          <div className="members-project-toggle">
            <button type="button" className="secondary" disabled={busy}
              onClick={() => setSelected(
                selected.size === orgProjects.length
                  ? new Set()
                  : new Set(orgProjects.map(p => p.id))
              )}>
              {selected.size === orgProjects.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </button>
          </div>
          <ul className="members-project-list">
            {orgProjects.map(project => (
              <li key={project.id}>
                <label>
                  <input type="checkbox" checked={selected.has(project.id)}
                    onChange={() => toggle(project.id)} disabled={busy}/>
                  <span>{project.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </>}
      {dirty && orgProjects.length > 0 && (
        <div className="actions">
          <button type="button" onClick={() => onSave([...selected])} disabled={busy}>
            Guardar asignación
          </button>
          <button type="button" className="secondary"
            onClick={() => setSelected(new Set(member.projects.map(p => p.id)))} disabled={busy}>
            Descartar
          </button>
        </div>
      )}
    </details>
  );
}

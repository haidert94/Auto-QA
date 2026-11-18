'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RoleFields } from '../onboarding-fields';
import {
  apiProjects, environmentForm, environmentPayload, executionForm, limitFields,
  roleForm, type Project, type RoleForm,
} from '../onboarding';

export function RolesDialog({ project, onClose, onSaved }: {
  project: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [roles, setRoles] = useState<RoleForm[]>(() => project.roles.map(roleForm));
  const [enabled, setEnabled] = useState(() => project.roles.length > 0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setErrors([]);
    const execution = executionForm(project.executionSettings);
    const { browser, frequency, notifications } = execution;
    const limits = Object.fromEntries(
      (Object.keys(limitFields) as (keyof typeof limitFields)[])
        .filter(key => execution[key] !== '')
        .map(key => [key, Number(execution[key])]),
    );
    try {
      const response = await fetch(`${apiProjects}/${project.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: project.revision,
          status: project.status,
          name: project.name,
          description: project.description ?? undefined,
          ownerLabel: project.ownerLabel ?? undefined,
          priorityModules: project.priorityModules,
          environments: project.environments.map(environment => environmentPayload(environmentForm(environment))),
          roles: enabled ? roles.map(role => ({
            ...role,
            name: role.name.trim(),
            description: role.description.trim() || undefined,
            secretReference: role.secretReference.trim() || undefined,
          })) : [],
          executionSettings: {
            ...limits,
            browser: browser || undefined,
            frequency: frequency.trim() || undefined,
            notifications: notifications.trim() || undefined,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload.message ?? 'No se pudo guardar los roles.';
        setErrors(Array.isArray(message) ? message : [message]);
        return;
      }
      const updated: Project = await response.json();
      onSaved(updated);
    } catch {
      setErrors(['No se pudo guardar. Comprueba que la API esté ejecutándose.']);
    } finally { setBusy(false); }
  }

  function addRole() {
    if (roles.length >= 20) return;
    setRoles(list => [...list, { name: '', description: '', secretReference: '', permissions: [] }]);
  }

  return <dialog ref={dialog} className="environments-dialog roles-dialog" aria-labelledby="roles-dialog-title"
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <header className="environments-dialog__head">
      <h2 id="roles-dialog-title">Roles y matriz de autorización</h2>
      <button type="button" className="secondary" onClick={onClose} disabled={busy} aria-label="Cerrar">×</button>
    </header>
    <form onSubmit={save} className="environments-dialog__form">
      <fieldset className="form-content" disabled={busy || project.status === 'ARCHIVED'}>
        <label className="check roles-dialog__toggle">
          <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
          Necesito probar flujos por rol o permisos de usuario.
        </label>
        <p className="muted">
          Declara los roles que existen en la aplicación y qué debería poder o no hacer cada uno.
          Esta matriz se usará para generar escenarios de permisos cuando el runner lo soporte.
          Usa referencias de bóveda (vault:…) para cuentas de prueba; no pongas contraseñas aquí.
        </p>
        {enabled && <>
          {roles.map((role, index) => (
            <RoleFields key={index} index={index} value={role}
              onChange={next => setRoles(list => list.map((item, n) => n === index ? next : item))}
              onRemove={() => setRoles(list => list.filter((_, n) => n !== index))} />
          ))}
          <button type="button" className="secondary" disabled={roles.length >= 20} onClick={addRole}>
            Agregar rol
          </button>
        </>}
      </fieldset>
      {errors.length > 0 && <div className="errors" role="alert">
        {errors.map(message => <p key={message} className="error">{message}</p>)}
      </div>}
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button>
      </div>
    </form>
  </dialog>;
}

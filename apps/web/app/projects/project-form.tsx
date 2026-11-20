'use client';

import { useRouter } from 'next/navigation';
import { DocumentPanel } from './document-panel';
import { documentRequest, type PendingDocument } from './document-client';
import { useState, type FormEvent } from 'react';
import type { OrgRole } from '../autoqa-server';
import { EnvironmentFields, ExecutionFields, RoleFields, TextField } from './onboarding-fields';
import {
  apiProjects, environmentForm, environmentPayload, executionForm, lines, limitFields,
  roleForm, statusLabels, type Project,
} from './onboarding';

function formValues(project?: Project) {
  const roles = project?.roles.map(roleForm) ?? [];
  return {
    name: project?.name ?? '',
    description: project?.description ?? '',
    ownerLabel: project?.ownerLabel ?? '',
    priorities: project?.priorityModules.join('\n') ?? '',
    environments: project?.environments.map(environmentForm) ?? [],
    // Opt-in: la sección de roles solo se muestra si el proyecto ya tiene
    // roles declarados, o si el usuario marca el checkbox para habilitarla.
    rolesEnabled: roles.length > 0,
    roles,
    execution: executionForm(project?.executionSettings),
  };
}

export function ProjectForm({ initial, onSaved, role }: { initial?: Project; onSaved?: (project: Project) => void; role?: OrgRole }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(() => formValues(initial));
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [uploading, setUploading] = useState(false);

  async function uploadPending(projectId: string) {
    if (!pending.length) return true;
    setUploading(true);
    let complete = true;
    try {
      for (const item of pending) {
        setPending(queue => queue.map(entry => entry.id === item.id
          ? { ...entry, state: 'UPLOADING', error: undefined } : entry));
        const data = new FormData();
        data.append('files', item.file);
        data.append('type', item.type);
        try {
          await documentRequest(projectId, '', { method: 'POST', body: data });
          setPending(queue => queue.filter(entry => entry.id !== item.id));
        } catch (error) {
          complete = false;
          setPending(queue => queue.map(entry => entry.id === item.id ? {
            ...entry, state: 'ERROR',
            error: error instanceof Error ? error.message : 'No se pudo cargar este archivo.',
          } : entry));
        }
      }
      return complete;
    } finally {
      setUploading(false);
      setDocumentRevision(value => value + 1);
    }
  }

  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(previous => ({ ...previous, [key]: value }));
    setNotice('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const status = submitter?.value === 'READY' ? 'READY' : 'DRAFT';
    const { browser, frequency, notifications } = form.execution;
    const limits = Object.fromEntries(
      (Object.keys(limitFields) as (keyof typeof limitFields)[])
        .filter(key => form.execution[key] !== '')
        .map(key => [key, Number(form.execution[key])]),
    );
    setBusy(true);
    setErrors([]);
    setNotice('');
    try {
      const url = saved ? `${apiProjects}/${saved.id}` : apiProjects;
      const response = await fetch(url, {
        method: saved ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: saved?.revision,
          status,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          ownerLabel: form.ownerLabel.trim() || undefined,
          priorityModules: lines(form.priorities),
          environments: form.environments.map(environmentPayload),
          // Si el usuario desactiva la sección, enviamos un array vacío para
          // que el backend borre los roles previamente guardados.
          roles: form.rolesEnabled ? form.roles.map(role => ({
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
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        const message = result.message ?? 'No se pudo guardar el registro.';
        setErrors(Array.isArray(message) ? message : [message]);
        return;
      }

      const project: Project = await response.json();
      setSaved(project);
      setForm(formValues(project));
      setNotice(status === 'READY' ? 'Registro completo guardado.' : 'Borrador guardado.');
      const uploaded = await uploadPending(project.id);
      if (!uploaded) setNotice('Proyecto guardado. Hay archivos pendientes que puedes reintentar.');
      if (!initial && uploaded) router.replace('/projects/' + project.id);
      else if (uploaded) {
        // Para que el server component vuelva a fetchear el IPA y refleje el
        // nuevo estado; el padre decide si cambiar de modo vista/edición.
        router.refresh();
        onSaved?.(project);
      }
    } catch {
      setErrors(['No se pudo guardar. Comprueba que la API esté ejecutándose.']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h1>{saved?.name ?? 'Registrar aplicación'}</h1>
      {saved && <p className="muted">Estado guardado · {statusLabels[saved.status]}</p>}
      {saved?.missingRequirements.length ? (
        <div className="status">
          <strong>Pendientes del registro guardado</strong>
          <ul>{saved.missingRequirements.map(message => <li key={message}>{message}</li>)}</ul>
        </div>
      ) : null}
      <form onSubmit={submit}>
        <fieldset className="form-content" disabled={busy || uploading || saved?.status === 'ARCHIVED'}>
          <div className="form-grid">
            <TextField label="Nombre de la aplicación" required maxLength={120} value={form.name}
              onChange={value => change('name', value)} />
            <TextField label="Propietario declarado" maxLength={120} value={form.ownerLabel}
              placeholder="Equipo responsable" onChange={value => change('ownerLabel', value)} />
          </div>
          <TextField label="Descripción" maxLength={1000} value={form.description} multiline
            onChange={value => change('description', value)} />
          <TextField label="Módulos prioritarios, uno por línea" value={form.priorities} multiline
            onChange={value => change('priorities', value)} />
          <h2 id="environment-heading">Entornos y alcance</h2>
          {form.environments.map((env, index) => (
            <EnvironmentFields key={env.id ?? `new-${index}`} index={index} value={env}
              onChange={value => change('environments', form.environments.map((item, n) => n === index ? value : item))}
              onRemove={() => change('environments', form.environments.filter((_, n) => n !== index))} />
          ))}
          <button type="button" className="secondary" disabled={form.environments.length >= 20}
            onClick={() => change('environments', [...form.environments, environmentForm()])}>Agregar entorno</button>

          <DocumentPanel
            projectId={saved?.id}
            disabled={busy || saved?.status === 'ARCHIVED'}
            uploading={uploading}
            revision={documentRevision + (saved?.revision ?? 0)}
            pending={pending}
            setPending={setPending}
            upload={() => { if (saved) void uploadPending(saved.id); }}
            role={role}
          />


          <h2 id="role-heading">Roles de la aplicación</h2>
          <label className="check">
            <input type="checkbox" checked={form.rolesEnabled}
              onChange={event => change('rolesEnabled', event.target.checked)} />
            <span>Necesito probar flujos por rol o permisos de usuario (opcional).</span>
          </label>
          {form.rolesEnabled && (
            <>
              <p className="muted">
                Declara los roles que existen en la aplicación y qué debería poder o no hacer cada uno. Esta matriz
                se usará para generar escenarios de permisos cuando el runner lo soporte. Usa referencias de bóveda
                (<code>vault:…</code>) para cuentas de prueba; no pongas contraseñas aquí (esas van en el entorno).
              </p>
              {form.roles.map((role, index) => (
                <RoleFields key={index} index={index} value={role}
                  onChange={value => change('roles', form.roles.map((item, n) => n === index ? value : item))}
                  onRemove={() => change('roles', form.roles.filter((_, n) => n !== index))} />
              ))}
              <button type="button" className="secondary" disabled={form.roles.length >= 30}
                onClick={() => change('roles', [...form.roles, roleForm()])}>Agregar rol</button>
            </>
          )}

          <ExecutionFields value={form.execution} onChange={value => change('execution', value)} />
          {errors.length > 0 && <div role="alert" className="error status">
            <strong>Revisa estos datos</strong>
            <ul>{errors.map(message => <li key={message}>{message}</li>)}</ul>
          </div>}
          {notice && <p className="success" role="status">{notice}</p>}
          <div className="actions">
            <button type="submit" value="DRAFT" className="secondary">Guardar borrador</button>
            <button type="submit" value="READY">Completar registro</button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EnvironmentFields } from '../onboarding-fields';
import {
  apiProjects, environmentForm, environmentPayload, executionForm, limitFields,
  roleForm, type Project,
} from '../onboarding';

export function EnvironmentsDialog({ project, onClose, onSaved }: {
  project: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [environments, setEnvironments] = useState(() => project.environments.map(environmentForm));
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
          environments: environments.map(environmentPayload),
          roles: project.roles.map(role => {
            const form = roleForm(role);
            return {
              ...form,
              name: form.name.trim(),
              description: form.description.trim() || undefined,
              secretReference: form.secretReference.trim() || undefined,
            };
          }),
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
        const message = payload.message ?? 'No se pudo guardar los entornos.';
        setErrors(Array.isArray(message) ? message : [message]);
        return;
      }
      const updated: Project = await response.json();
      onSaved(updated);
    } catch {
      setErrors(['No se pudo guardar. Comprueba que la API esté ejecutándose.']);
    } finally { setBusy(false); }
  }

  function addEnvironment() {
    if (environments.length >= 20) return;
    setEnvironments(list => [...list, environmentForm()]);
  }

  return <dialog ref={dialog} className="environments-dialog" aria-labelledby="environments-dialog-title"
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <header className="environments-dialog__head">
      <h2 id="environments-dialog-title">Entornos y alcance</h2>
      <button type="button" className="secondary" onClick={onClose} disabled={busy} aria-label="Cerrar">×</button>
    </header>
    <form onSubmit={save} className="environments-dialog__form">
      <fieldset className="form-content" disabled={busy || project.status === 'ARCHIVED'}>
        {environments.map((env, index) => (
          <EnvironmentFields key={env.id ?? `new-${index}`} index={index} value={env}
            onChange={value => setEnvironments(list => list.map((item, n) => n === index ? value : item))}
            onRemove={() => setEnvironments(list => list.filter((_, n) => n !== index))} />
        ))}
        <button type="button" className="secondary" disabled={environments.length >= 20} onClick={addEnvironment}>
          Agregar entorno
        </button>
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

'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { EnvironmentFields } from '../onboarding-fields';
import {
  apiProjects, environmentForm, environmentPayload, executionForm, limitFields,
  roleForm, type Project,
} from '../onboarding';

// El back responde con strings tipo "Entorno 1: <mensaje>" o mensajes
// generales sin prefijo. Los agrupamos por índice para mostrarlos pegados
// a la tarjeta que los causó, en vez de en un bloque al final.
function groupErrors(messages: string[]): { general: string[]; perEnv: Map<number, string[]> } {
  const general: string[] = [];
  const perEnv = new Map<number, string[]>();
  for (const message of messages) {
    const match = message.match(/^Entorno\s+(\d+)\s*:\s*(.+)$/);
    if (!match) { general.push(message); continue; }
    const index = Number(match[1]) - 1;
    const text = match[2];
    const bucket = perEnv.get(index) ?? [];
    bucket.push(text);
    perEnv.set(index, bucket);
  }
  return { general, perEnv };
}

export function EnvironmentsDialog({ project, onClose, onSaved }: {
  project: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const envRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [environments, setEnvironments] = useState(() => project.environments.map(environmentForm));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const grouped = groupErrors(errors);

  useEffect(() => { dialog.current?.showModal(); }, []);

  // Después de un intento de guardado con errores por entorno, llevamos el
  // foco visual al primer entorno marcado, para que el usuario no tenga que
  // buscar qué tarjeta se quejó.
  useLayoutEffect(() => {
    if (!errors.length) return;
    const first = [...grouped.perEnv.keys()].sort((a, b) => a - b)[0];
    if (first === undefined) return;
    envRefs.current[first]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [errors, grouped.perEnv]);

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
        {environments.map((env, index) => {
          const envMessages = grouped.perEnv.get(index) ?? [];
          return <div key={env.id ?? `new-${index}`}
            ref={node => { envRefs.current[index] = node; }}
            className={envMessages.length ? 'env-slot env-slot--invalid' : 'env-slot'}>
            <EnvironmentFields index={index} value={env}
              onChange={value => setEnvironments(list => list.map((item, n) => n === index ? value : item))}
              onRemove={() => setEnvironments(list => list.filter((_, n) => n !== index))} />
            {envMessages.length > 0 && <ul className="env-slot__errors" role="alert">
              {envMessages.map(message => <li key={message}>{message}</li>)}
            </ul>}
          </div>;
        })}
        <button type="button" className="secondary" disabled={environments.length >= 20} onClick={addEnvironment}>
          Agregar entorno
        </button>
      </fieldset>
      {grouped.general.length > 0 && <div className="errors" role="alert">
        {grouped.general.map(message => <p key={message} className="error">{message}</p>)}
      </div>}
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button>
      </div>
    </form>
  </dialog>;
}

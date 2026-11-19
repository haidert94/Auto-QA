'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { environmentTypes, scenarioRunEnvironmentError, supportsScenarioWrites, type Project } from '../onboarding';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { EnvironmentsDialog } from './environments-dialog';
import type { ScenarioListItem } from './scenario-card';
import type { GeneratedSpec } from './automation-export';

export function ScenarioRunDialog({ project, role, scenarios, specs, onClose, onQueued }: {
  project: Project; role?: OrgRole; scenarios: ScenarioListItem[];
  specs?: Record<string, GeneratedSpec>;
  onClose: () => void; onQueued: () => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  const [editingEnvironmentId, setEditingEnvironmentId] = useState<string | null>(null);
  const currentProject = savedProject && savedProject.revision > project.revision ? savedProject : project;
  const environments = currentProject.environments.filter(item => !scenarioRunEnvironmentError(item));
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? '');
  const [confirmedScope, setConfirmedScope] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ title: string; queued: boolean; detail: string }[] | null>(null);
  const environment = environments.find(item => item.id === environmentId);
  const allowsWrites = environment?.readOnly === false;
  const scope = environment ? JSON.stringify([environment.id, environment.readOnly, environment.authorizedAt]) : null;
  const confirmed = scope !== null && confirmedScope === scope;
  const canConfigureWrites = !!environment && !allowsWrites && supportsScenarioWrites(environment.type)
    && currentProject.status !== 'ARCHIVED' && can(role, 'project.update');
  useEffect(() => { dialog.current?.showModal(); }, []);

  function environmentSaved(updated: Project) {
    setSavedProject(updated);
    setEditingEnvironmentId(null);
    setConfirmedScope(null);
    router.refresh();
  }

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || results || !confirmed || !environment || (allowsWrites && !environment.authorizedAt)) return;
    setBusy(true);
    const next = [];
    for (const scenario of scenarios) {
      try {
        const automationId = specs?.[scenario.id]?.automationId ?? scenario.playwright?.automationId ?? null;
        const response = await fetch(`/api/projects/${project.id}/scenarios/${scenario.id}/runs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            environmentId, automationId,
            writeAuthorizationAt: allowsWrites ? environment.authorizedAt : undefined,
          }),
          signal: AbortSignal.timeout(15000),
        });
        const payload = await response.json().catch(() => ({}));
        next.push({ title: scenario.title, queued: response.ok, detail: response.ok ? `En cola · ${payload.id}`
          : Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message ?? 'No se pudo encolar.' });
      } catch { next.push({ title: scenario.title, queued: false, detail: 'No se confirmó el envío. Consulta el reporte antes de volver a intentarlo.' }); }
    }
    setResults(next);
    setBusy(false);
    onQueued();
  }

  return <><dialog ref={dialog} className="scenario-run-dialog" aria-labelledby="suite-title"
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="suite-title">Ejecutar suite ({scenarios.length})</h2>
    <p>Se solicitará una ejecución por escenario. La API comprobará autorización, alcance, plan y cuotas.</p>
    <ul className="scenario-run-targets">{scenarios.map(scenario => <li key={scenario.id}>{scenario.title}</li>)}</ul>
    {!results ? <form onSubmit={queue}>
      <label>Entorno autorizado<select value={environment?.id ?? ''} onChange={event => { setEnvironmentId(event.target.value); setConfirmedScope(null); }} disabled={busy} required>
        {!environment && <option value="" disabled>Selecciona un entorno autorizado</option>}
        {environments.map(environment => <option key={environment.id} value={environment.id}>
          {environment.type ? environmentTypes[environment.type] : 'Entorno'} · {environment.baseUrl}
          {environment.readOnly ? ' · Solo lectura' : ' · Cambios con datos de prueba'}
        </option>)}
      </select></label>
      {canConfigureWrites && <div className="scenario-run-environment-help">
        <p>Para probar flujos que guardan datos o confirman pedidos, habilita los cambios en la configuración de este entorno.</p>
        <button type="button" className="secondary" disabled={busy}
          onClick={() => setEditingEnvironmentId(environment.id)}>Configurar cambios con datos de prueba</button>
      </div>}
      <label className="check">
        <input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmedScope(event.target.checked ? scope : null)} />
        {allowsWrites
          ? 'Confirmo ejecutar los escenarios seleccionados con cambios en los datos de prueba, dentro del alcance autorizado.'
          : 'Confirmo ejecutar los escenarios seleccionados en solo lectura, dentro del alcance autorizado.'}
      </label>
      <div className="actions"><button type="submit" disabled={busy || !environment || !confirmed}>{busy ? 'Encolando…' : 'Confirmar ejecución'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button></div>
    </form> : <>
      <ul className="scenario-queue-results" aria-live="polite">{results.map((result, i) => <li key={i}>
        <strong>{result.title}</strong><span className={result.queued ? 'success' : 'error'}>{result.detail}</span>
      </li>)}</ul>
      <p className="muted">En cola no significa que la prueba haya finalizado o pasado.</p>
      <div className="actions"><Link href="#reporte" className="button-like" onClick={onClose}>Ver reporte</Link>
        <button type="button" className="secondary" onClick={onClose}>Cerrar</button></div>
    </>}
  </dialog>
    {editingEnvironmentId && <EnvironmentsDialog project={currentProject} focusEnvironmentId={editingEnvironmentId}
      onClose={() => setEditingEnvironmentId(null)} onSaved={environmentSaved} />}
  </>;
}

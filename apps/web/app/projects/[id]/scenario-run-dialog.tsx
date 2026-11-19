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
import { runPresentation, type ScenarioRun } from './scenario-presentation';

type SuiteState =
  | { kind: 'sending' }
  | { kind: 'active'; runId: string }
  | { kind: 'finished'; run: ScenarioRun }
  | { kind: 'rejected' | 'unknown'; detail: string };

type SuiteResult = { scenarioId: string; title: string; state: SuiteState };

const runIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const unknownSubmission: SuiteState = {
  kind: 'unknown', detail: 'No se pudo confirmar el envío. Consulta el reporte antes de volver a intentarlo.',
};

function resultLabel(state: SuiteState) {
  switch (state.kind) {
    case 'sending': return { label: 'Enviando solicitud…', className: 'muted' };
    case 'active': return { label: 'Procesando…', className: 'muted' };
    case 'rejected': return { label: 'No ejecutado', className: 'error' };
    case 'unknown': return { label: 'Estado sin confirmar', className: 'muted' };
    case 'finished': {
      const { label, tone } = runPresentation(state.run, true);
      return { label, className: tone === 'passed' ? 'success' : tone === 'failed' ? 'error' : 'muted' };
    }
  }
}

export function ScenarioRunDialog({ project, role, scenarios, specs, onClose, onRunsChanged }: {
  project: Project; role?: OrgRole; scenarios: ScenarioListItem[];
  specs?: Record<string, GeneratedSpec>;
  onClose: () => void; onRunsChanged?: () => void;
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
  const [results, setResults] = useState<SuiteResult[] | null>(null);
  const [trackingWarning, setTrackingWarning] = useState('');
  const activeRunIds = busy ? '' : results?.flatMap(({ state }) => state.kind === 'active' ? [state.runId] : []).join(',') ?? '';
  const finished = results?.filter(({ state }) => state.kind === 'finished').length ?? 0;
  const pending = results?.filter(({ state }) => state.kind === 'active' || state.kind === 'sending').length ?? 0;
  const hasUnknown = results?.some(({ state }) => state.kind === 'unknown');
  const environment = environments.find(item => item.id === environmentId);
  const allowsWrites = environment?.readOnly === false;
  const scope = environment ? JSON.stringify([environment.id, environment.readOnly, environment.authorizedAt]) : null;
  const confirmed = scope !== null && confirmedScope === scope;
  const canConfigureWrites = !!environment && !allowsWrites && supportsScenarioWrites(environment.type)
    && currentProject.status !== 'ARCHIVED' && can(role, 'project.update');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!activeRunIds) return;
    const ids = activeRunIds.split(',');
    const controller = new AbortController();
    let timer: number | undefined;

    async function refreshStatus() {
      try {
        const runs = new Map<string, ScenarioRun>();
        for (let start = 0; start < ids.length; start += 100) {
          const search = new URLSearchParams({ ids: ids.slice(start, start + 100).join(',') });
          const response = await fetch(`/api/projects/${project.id}/runs?${search}`, {
            cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
          });
          if (!response.ok) throw new Error('No se pudo consultar la ejecución.');
          const batch: ScenarioRun[] = await response.json();
          if (!Array.isArray(batch)) throw new Error('La API devolvió un estado inválido.');
          for (const run of batch) runs.set(run.id, run);
        }
        if (controller.signal.aborted) return;
        const updates = new Map<string, SuiteState>();
        for (const id of ids) {
          const run = runs.get(id);
          if (!run) updates.set(id, { kind: 'unknown', detail: 'La ejecución no está disponible. Consulta el reporte.' });
          else if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELED') {
            updates.set(id, { kind: 'finished', run });
          }
        }
        setTrackingWarning('');
        if (updates.size) {
          setResults(current => current?.map(result => {
            const state = result.state.kind === 'active' ? updates.get(result.state.runId) : undefined;
            return state ? { ...result, state } : result;
          }) ?? null);
          if (updates.size === ids.length) onRunsChanged?.();
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        setTrackingWarning('No se pudo actualizar el estado. Reintentando…');
      }
      timer = window.setTimeout(() => void refreshStatus(), 3000);
    }

    void refreshStatus();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [activeRunIds, project.id, onRunsChanged]);

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
    setResults(scenarios.map(({ id, title }) => ({ scenarioId: id, title, state: { kind: 'sending' } })));
    let accepted = false;
    for (const scenario of scenarios) {
      let state: SuiteState = unknownSubmission;
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
        if (!response.ok) {
          const detail = Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message;
          state = response.status < 500
            ? { kind: 'rejected', detail: typeof detail === 'string' && detail ? detail : 'La API rechazó la ejecución.' }
            : unknownSubmission;
        } else if (typeof payload.id === 'string' && runIdPattern.test(payload.id)) {
          state = { kind: 'active', runId: payload.id };
          accepted = true;
        }
      } catch { /* Se desconoce si el servidor recibió la solicitud. */ }
      const submission = state;
      setResults(current => current?.map(result => result.scenarioId === scenario.id
        ? { ...result, state: submission } : result) ?? null);
    }
    setBusy(false);
    if (accepted) onRunsChanged?.();
  }

  return <><dialog ref={dialog} className="scenario-run-dialog" aria-labelledby="suite-title"
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="suite-title">Ejecutar suite ({scenarios.length})</h2>
    {!results ? <>
      <p>Se solicitará una ejecución por escenario. La API comprobará autorización, alcance, plan y cuotas.</p>
      <ul className="scenario-run-targets">{scenarios.map(scenario => <li key={scenario.id}>{scenario.title}</li>)}</ul>
      <form onSubmit={queue}>
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
        <div className="actions"><button type="submit" disabled={busy || !environment || !confirmed}>Confirmar ejecución</button>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button></div>
      </form>
    </> : <>
      <p role="status">{busy || pending ? `Procesando… ${results.length - pending} de ${results.length} escenarios con estado final.`
        : hasUnknown ? 'Hay ejecuciones con estado sin confirmar.'
        : finished === 0 ? 'La suite no se inició.'
        : `Ejecuciones finalizadas (${finished}/${results.length}).`}</p>
      {trackingWarning && <p role="status">{trackingWarning}</p>}
      <ul className="scenario-queue-results">{results.map(({ scenarioId, title, state }) => {
        const { label, className } = resultLabel(state);
        return <li key={scenarioId}>
          <strong>{title}</strong><span className={className}>{label}</span>
          {'detail' in state && <span className={className}>{state.detail}</span>}
        </li>;
      })}</ul>
      {!busy && <div className="actions"><Link href="#reporte" className="button-like" onClick={onClose}>Ver reporte</Link>
        <button type="button" className="secondary" onClick={onClose}>Cerrar</button></div>}
    </>}
  </dialog>
    {editingEnvironmentId && <EnvironmentsDialog project={currentProject} focusEnvironmentId={editingEnvironmentId}
      onClose={() => setEditingEnvironmentId(null)} onSaved={environmentSaved} />}
  </>;
}

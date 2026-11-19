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
import { runPresentation } from './scenario-presentation';
import { runScenarioSuite, type SuiteResult, type SuiteState } from './scenario-suite';

function resultLabel(state: SuiteState) {
  switch (state.kind) {
    case 'waiting': return { label: 'Esperando turno…', className: 'muted' };
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
  const suite = useRef<AbortController | null>(null);
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  const [editingEnvironmentId, setEditingEnvironmentId] = useState<string | null>(null);
  const currentProject = savedProject && savedProject.revision > project.revision ? savedProject : project;
  const environments = currentProject.environments.filter(item => !scenarioRunEnvironmentError(item));
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? '');
  const [confirmedScope, setConfirmedScope] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SuiteResult[] | null>(null);
  const [trackingWarning, setTrackingWarning] = useState('');
  const finished = results?.filter(({ state }) => state.kind === 'finished').length ?? 0;
  const pending = results?.filter(({ state }) => state.kind === 'active' || state.kind === 'waiting').length ?? 0;
  const hasUnknown = results?.some(({ state }) => state.kind === 'unknown');
  const environment = environments.find(item => item.id === environmentId);
  const allowsWrites = environment?.readOnly === false;
  const scope = environment ? JSON.stringify([environment.id, environment.readOnly, environment.authorizedAt]) : null;
  const confirmed = scope !== null && confirmedScope === scope;
  const canConfigureWrites = !!environment && !allowsWrites && supportsScenarioWrites(environment.type)
    && currentProject.status !== 'ARCHIVED' && can(role, 'project.update');
  useEffect(() => {
    dialog.current?.showModal();
    return () => suite.current?.abort();
  }, []);

  function environmentSaved(updated: Project) {
    setSavedProject(updated);
    setEditingEnvironmentId(null);
    setConfirmedScope(null);
    router.refresh();
  }

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (suite.current || results || !confirmed || !environment || (allowsWrites && !environment.authorizedAt)) return;
    const controller = new AbortController();
    suite.current = controller;
    setBusy(true);
    try {
      await runScenarioSuite({
        projectId: project.id,
        scenarios: scenarios.map(scenario => ({
          scenarioId: scenario.id,
          title: scenario.title,
          automationId: specs?.[scenario.id]?.automationId ?? scenario.playwright?.automationId ?? null,
        })),
        environmentId,
        writeAuthorizationAt: allowsWrites ? environment.authorizedAt ?? undefined : undefined,
        signal: controller.signal,
        onProgress: setResults,
        onWarning: setTrackingWarning,
      });
      if (!controller.signal.aborted) onRunsChanged?.();
    } finally {
      suite.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
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
      <div className="actions">
        {busy ? <button type="button" disabled>Ver reporte</button>
          : <Link href="#reporte" className="button-like" onClick={onClose}>Ver reporte</Link>}
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cerrar</button>
      </div>
    </>}
  </dialog>
    {editingEnvironmentId && <EnvironmentsDialog project={currentProject} focusEnvironmentId={editingEnvironmentId}
      onClose={() => setEditingEnvironmentId(null)} onSaved={environmentSaved} />}
  </>;
}

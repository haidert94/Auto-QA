'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { environmentTypes, scenarioRunEnvironmentError, supportsScenarioWrites, type Project } from '../onboarding';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { isReportableRunStatus } from '../../../../api/src/runs/run-report-policy';
import { EnvironmentsDialog } from './environments-dialog';
import { SuiteQualityConfiguration } from './suite-quality-configuration';
import type { ScenarioListItem } from './scenario-card';
import type { GeneratedSpec } from './automation-export';
import { runPresentation } from './scenario-presentation';
import { runScenarioSuite, type SuiteResult, type SuiteState } from './scenario-suite';

function resultLabel(state: SuiteState) {
  switch (state.kind) {
    case 'waiting': return { label: 'Esperando turno…', className: 'muted' };
    case 'active': return { label: { queued: 'En cola', running: 'En ejecución', stopping: 'Deteniéndose' }[state.phase], className: 'muted' };
    case 'rejected': return { label: 'No ejecutado', className: 'error' };
    case 'unknown': return { label: 'Estado sin confirmar', className: 'muted' };
    case 'finished': {
      const { label, tone } = runPresentation(state.run, true);
      return { label, className: tone === 'passed' ? 'success' : tone === 'failed' ? 'error' : 'muted' };
    }
  }
}

export type ScenarioSuiteControl = { stop: () => Promise<void> };

export function ScenarioRunDialog({ project, role, scenarios, qualityScenarios, specs, control, open, onHide, onClose, onViewReport, onRunningChange, onRunsChanged, onProgress, onTrackingWarning }: {
  project: Project; role?: OrgRole; scenarios: ScenarioListItem[];
  qualityScenarios: ScenarioListItem[];
  specs?: Record<string, GeneratedSpec>;
  control: Ref<ScenarioSuiteControl>;
  open: boolean; onHide: () => void; onClose: () => void; onViewReport: () => void;
  onRunningChange: (running: boolean) => void; onRunsChanged?: () => void;
  onProgress: (results: SuiteResult[]) => void;
  onTrackingWarning: (warning: string) => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const suite = useRef<{ controller: AbortController; finished: Promise<void> } | null>(null);
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  const [editingEnvironmentId, setEditingEnvironmentId] = useState<string | null>(null);
  const currentProject = savedProject && savedProject.revision > project.revision ? savedProject : project;
  const environments = currentProject.environments.filter(item => !scenarioRunEnvironmentError(item));
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? '');
  const [showQuality, setShowQuality] = useState(qualityScenarios.length > 0);
  const [confirmedScope, setConfirmedScope] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SuiteResult[] | null>(null);
  const [trackingWarning, setTrackingWarning] = useState('');
  const finished = results?.filter(({ state }) => state.kind === 'finished').length ?? 0;
  const hasReportableRun = results?.some(({ state }) => state.kind === 'finished' && isReportableRunStatus(state.run.status));
  const pending = results?.filter(({ state }) => state.kind === 'active' || state.kind === 'waiting').length ?? 0;
  const hasUnknown = results?.some(({ state }) => state.kind === 'unknown');
  const environment = environments.find(item => item.id === environmentId);
  const allowsWrites = environment?.readOnly === false;
  const scope = environment ? JSON.stringify([environment.id, environment.readOnly, environment.authorizedAt]) : null;
  const confirmed = scope !== null && confirmedScope === scope;
  const canConfigureWrites = !!environment && !allowsWrites && supportsScenarioWrites(environment.type)
    && currentProject.status !== 'ARCHIVED' && can(role, 'project.update');
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) element.showModal();
    else element.close();
  }, [open]);
  useEffect(() => () => suite.current?.controller.abort(), []);
  useImperativeHandle(control, () => ({
    async stop() {
      const activeSuite = suite.current;
      if (!activeSuite) return;
      activeSuite.controller.abort();
      await activeSuite.finished;
    },
  }), []);

  function close() {
    if (suite.current) onHide();
    else onClose();
  }

  function environmentSaved(updated: Project) {
    setSavedProject(updated);
    setEditingEnvironmentId(null);
    setConfirmedScope(null);
    router.refresh();
  }

  function changeStep(review: boolean) {
    setShowQuality(review);
    setConfirmedScope(null);
    requestAnimationFrame(() => dialog.current?.querySelector('h2')?.focus());
  }

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (showQuality || !scenarios.length || suite.current || results || !confirmed || !environment || (allowsWrites && !environment.authorizedAt)) return;
    const controller = new AbortController();
    setBusy(true);
    onRunningChange(true);
    onTrackingWarning('');
    const finished = runScenarioSuite({
      projectId: project.id,
      scenarios: scenarios.map(scenario => ({
        scenarioId: scenario.id,
        title: scenario.title,
        automationId: specs?.[scenario.id]?.automationId ?? scenario.playwright?.automationId ?? null,
      })),
      environmentId,
      writeAuthorizationAt: allowsWrites ? environment.authorizedAt ?? undefined : undefined,
      signal: controller.signal,
      onProgress: next => { setResults(next); onProgress(next); },
      onWarning: warning => { setTrackingWarning(warning); onTrackingWarning(warning); },
    });
    suite.current = { controller, finished };
    try {
      await finished;
      if (!controller.signal.aborted) onRunsChanged?.();
    } finally {
      suite.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        onRunningChange(false);
      }
    }
  }

  return <><dialog ref={dialog} className="scenario-run-dialog" aria-labelledby="suite-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <h2 id="suite-title" tabIndex={-1}>Ejecutar suite ({scenarios.length + (showQuality ? qualityScenarios.length : 0)})</h2>
    {showQuality ? <>
      <SuiteQualityConfiguration project={currentProject} scenarios={qualityScenarios} />
      <div className="actions">
        {scenarios.length > 0 && <button type="button" onClick={() => changeStep(false)}>
          Continuar con Playwright ({scenarios.length})
        </button>}
        <button type="button" className="secondary" onClick={onClose}>{scenarios.length ? 'Cancelar' : 'Cerrar'}</button>
      </div>
    </> : !results ? <>
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
          {qualityScenarios.length > 0 && <button type="button" className="secondary" disabled={busy}
            onClick={() => changeStep(true)}>Volver a configuración</button>}
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button></div>
      </form>
    </> : <>
      <p role="status">{busy || pending ? `Suite en curso · ${finished} de ${results.length} pruebas finalizadas.`
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
        <button type="button" disabled={busy || pending > 0 || !hasReportableRun || hasUnknown} onClick={onViewReport}>Ver reporte</button>
        <button type="button" className="secondary" onClick={close}>Cerrar</button>
      </div>
    </>}
  </dialog>
    {editingEnvironmentId && <EnvironmentsDialog project={currentProject} focusEnvironmentId={editingEnvironmentId}
      onClose={() => setEditingEnvironmentId(null)} onSaved={environmentSaved} />}
  </>;
}

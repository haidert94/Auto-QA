'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { environmentTypes, scenarioRunEnvironmentError, supportsScenarioWrites, type Project } from '../onboarding';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { isReportableRunStatus } from '../../../../api/src/runs/run-report-policy';
import { EnvironmentsDialog } from './environments-dialog';
import { SuiteQualityConfiguration } from './suite-quality-configuration';
import { qualityExecutionProblem } from './suite-quality-availability';
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
      if (state.run.status === 'COMPLETED' && state.quality) {
        return state.run.results.length ? { label: 'Pasó', className: 'success' } : { label: 'Finalizada', className: 'muted' };
      }
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
  open: boolean; onHide: () => void; onClose: () => void; onViewReport: (qualityOnly: boolean) => void;
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
  const candidates = [...scenarios, ...qualityScenarios];
  const runnable = [...scenarios, ...qualityScenarios.filter(item => !qualityExecutionProblem(item, currentProject, role))];
  const [selectedIds, setSelectedIds] = useState(() => new Set(runnable.map(scenario => scenario.id)));
  const selectedScenarios = runnable.filter(scenario => selectedIds.has(scenario.id));
  const selectedQuality = selectedScenarios.filter(scenario => scenario.quality);
  const hasBrowser = selectedScenarios.length > selectedQuality.length;
  const selectAll = useRef<HTMLInputElement>(null);
  const allSelected = runnable.length > 0 && selectedScenarios.length === runnable.length;
  const someSelected = selectedScenarios.length > 0 && !allSelected;
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
  const scope = hasBrowser ? (environment ? JSON.stringify([environment.id, environment.readOnly, environment.authorizedAt]) : null) : 'quality';
  const confirmed = scope !== null && confirmedScope === scope;
  const canConfigureWrites = !!environment && !allowsWrites && supportsScenarioWrites(environment.type)
    && currentProject.status !== 'ARCHIVED' && can(role, 'project.update');
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) element.showModal();
    else element.close();
  }, [open]);
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = someSelected;
  }, [someSelected]);
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

  function updateSelection(id: string | null, checked: boolean) {
    setConfirmedScope(null);
    setSelectedIds(previous => {
      if (id === null) return new Set(checked ? runnable.map(scenario => scenario.id) : []);
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedScenarios.length || suite.current || results || !confirmed || (hasBrowser && (!environment || (allowsWrites && !environment.authorizedAt)))) return;
    const controller = new AbortController();
    setBusy(true);
    onRunningChange(true);
    onTrackingWarning('');
    const finished = runScenarioSuite({
      projectId: project.id,
      scenarios: selectedScenarios.map(scenario => ({
        scenarioId: scenario.id,
        title: scenario.title,
        automationId: specs?.[scenario.id]?.automationId ?? scenario.playwright?.automationId ?? null,
        quality: scenario.quality ? { kind: scenario.quality.kind, resourceId: scenario.quality.resourceId } : undefined,
      })),
      environmentId,
      writeAuthorizationAt: hasBrowser && allowsWrites ? environment?.authorizedAt ?? undefined : undefined,
      signal: controller.signal,
      onProgress: next => { setResults(next); onProgress(next); },
      onWarning: warning => { setTrackingWarning(warning); onTrackingWarning(warning); },
    });
    suite.current = { controller, finished };
    try {
      await finished;
      if (!controller.signal.aborted) onRunsChanged?.();
    } catch {
      if (!controller.signal.aborted) onTrackingWarning('No se pudo completar el seguimiento de la suite.');
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
    <h2 id="suite-title" tabIndex={-1}>Ejecutar suite ({results?.length ?? selectedScenarios.length})</h2>
    {!results ? <>
      <p>Marca las pruebas que quieres ejecutar.</p>
      <form onSubmit={queue}>
        <fieldset className="scenario-run-selection" disabled={busy}>
          <legend>Pruebas para ejecutar</legend>
          {runnable.length > 1 && <label className="check scenario-run-select-all">
            <input ref={selectAll} type="checkbox" checked={allSelected} onChange={event => updateSelection(null, event.target.checked)} />
            Seleccionar todas
          </label>}
          <ul className="scenario-run-targets">{candidates.map(scenario => {
            const problem = qualityExecutionProblem(scenario, currentProject, role);
            return <li key={scenario.id}>
              <label className="check">
                <input type="checkbox" checked={!problem && selectedIds.has(scenario.id)} disabled={!!problem}
                  onChange={event => updateSelection(scenario.id, event.target.checked)} />
                <span>{scenario.title}{problem && <small>{problem}</small>}</span>
              </label>
            </li>;
          })}</ul>
        </fieldset>
        {selectedQuality.length > 0 && <SuiteQualityConfiguration project={currentProject} scenarios={selectedQuality} />}
        {hasBrowser && <>
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
        </>}
        <label className="check">
          <input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmedScope(event.target.checked ? scope : null)} />
          {!hasBrowser ? 'Confirmo ejecutar las pruebas seleccionadas dentro del alcance autorizado.' : allowsWrites
            ? 'Confirmo ejecutar los escenarios seleccionados con cambios en los datos de prueba, dentro del alcance autorizado.'
            : 'Confirmo ejecutar los escenarios seleccionados en solo lectura, dentro del alcance autorizado.'}
        </label>
        <div className="actions"><button type="submit" disabled={busy || !selectedScenarios.length || (hasBrowser && !environment) || !confirmed}>Confirmar ejecución</button>
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
        <button type="button" disabled={busy || pending > 0 || !hasReportableRun || hasUnknown} onClick={() => onViewReport(!hasBrowser)}>Ver reporte</button>
        <button type="button" className="secondary" onClick={close}>Cerrar</button>
      </div>
    </>}
  </dialog>
    {editingEnvironmentId && <EnvironmentsDialog project={currentProject} focusEnvironmentId={editingEnvironmentId}
      onClose={() => setEditingEnvironmentId(null)} onSaved={environmentSaved} />}
  </>;
}

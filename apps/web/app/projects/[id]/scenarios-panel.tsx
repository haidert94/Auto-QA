'use client';

import { createPortal } from 'react-dom';
import { ArrowRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type { RequirementOption, ScenarioListItem } from './scenario-card';
import { scenarioRunEnvironmentError, type Project } from '../onboarding';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { scenarioSpecSignature } from './automation-export';
import { GenerationCard } from './generation-card';
import { IPA_AUTOMATION_THRESHOLD } from './ipa-hero';
import { ProjectHeading } from './project-heading';
import { useScenarioHeader, useScenarioQuality, useScenarioSuite } from './project-tabs';
import { ScenarioExport } from './scenario-export';
import { ScenarioGenerationConfirmation } from './scenario-generation-confirmation';
import type { TestTypeCode } from '../document-client';
import { normalizeStepText } from './scenario-insights';
import { isManualScenario, type ScenarioRun } from './scenario-presentation';
import { ScenarioWorkspace } from './scenario-workspace';

type AutomationSummary = { id: string; status: string; stage: string | null; errorCode?: string | null; createdAt: string };
const generationErrors: Record<string, string> = {
  'ipa-traceability-blocked': 'La generación está bloqueada por el IPA. Revisa la trazabilidad y los pendientes en Datos.',
  'document-analysis-changed': 'El análisis documental cambió. Vuelve a confirmar la generación.',
  'review-missing': 'Explorer no pudo usar el análisis de la solicitud. Verifica que Explorer y la aplicación estén en la misma versión.',
  'project-missing': 'El proyecto ya no está disponible para generar casos.',
  'selection-empty': 'La solicitud quedó sin tipos de prueba. Abre de nuevo la confirmación.',
  'automation-crashed': 'El servicio de generación encontró un error interno. Consulta su registro.',
};

export function ScenariosPanel({ project, role }: { project: Project; role?: OrgRole }) {
  const canCreate = can(role, 'scenario.create');
  const canDelete = can(role, 'scenario.delete');
  const canRun = can(role, 'run.execute');
  const canSuggest = can(role, 'scenario.suggest');
  const canGenerate = can(role, 'automation.generate');
  const projectId = project.id;
  const projectBaseUrl = project.environments.find(environment => environment.authorizationConfirmed)?.baseUrl ?? null;
  const environments = project.environments.filter(environment => !scenarioRunEnvironmentError(environment));
  const runnable = project.status === 'READY' && environments.length > 0;
  const header = useScenarioHeader();
  const runner = useScenarioSuite();
  const updateCount = header?.setCount;
  const [items, setItems] = useState<ScenarioListItem[] | null>(null);
  const [listError, setListError] = useState('');
  const { items: qualityItems, error: qualityError, reload: loadQuality } = useScenarioQuality();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [runs, setRuns] = useState<ScenarioRun[]>([]);
  const [runsAvailable, setRunsAvailable] = useState(false);
  const [runsWarning, setRunsWarning] = useState('');
  const [requirements, setRequirements] = useState<RequirementOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [requirementId, setRequirementId] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [firstAction, setFirstAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ title: string; expectedResult?: string; steps: Array<{ action: string; data?: string; expected?: string }> }> | null>(null);
  const [suggestionMeta, setSuggestionMeta] = useState<{ model: string; usedFallback: boolean } | null>(null);
  const [ipaScore, setIpaScore] = useState<number | null>(null);
  const [ipaBlockers, setIpaBlockers] = useState<string[]>([]);
  const [ipaStatus, setIpaStatus] = useState<'ASSESSED' | 'BLOCKED' | null>(null);
  const [showGenerationConfirmation, setShowGenerationConfirmation] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateNotice, setGenerateNotice] = useState('');
  const deletionDisabled = busy || generating || !!listError || !!runner?.suiteRunning || !!runner?.stopping;

  const total = items === null ? null : items.length + qualityItems.length;
  useEffect(() => { updateCount?.(total); }, [updateCount, total]);

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/runs`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Historial no disponible');
      setRuns(await response.json()); setRunsAvailable(true); setRunsWarning('');
    } catch { setRunsAvailable(false); setRunsWarning('No se pudo consultar el historial. Los estados de ejecución no están disponibles.'); }
  }, [projectId]);
  useEffect(() => { void loadRuns(); }, [loadRuns, runner?.historyVersion]);

  async function suggest() {
    if (!requirementId) { setError('Selecciona primero un requisito para sugerir escenarios.'); return; }
    setSuggesting(true); setError(''); setSuggestions(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios/suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirementId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo generar sugerencias.'); return; }
      setSuggestions(Array.isArray(payload.scenarios) ? payload.scenarios : []);
      setSuggestionMeta({ model: payload.model ?? 'rule-based', usedFallback: !!payload.usedFallback });
    } catch { setError('No se pudo generar sugerencias.'); }
    finally { setSuggesting(false); }
  }

  async function createFromSuggestion(suggestion: { title: string; expectedResult?: string; steps: Array<{ action: string; data?: string; expected?: string }> }) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: suggestion.title.trim(),
          requirementId: requirementId || undefined,
          expectedResult: suggestion.expectedResult?.trim() || undefined,
          steps: suggestion.steps.map((s, i) => ({ ordinal: i + 1, action: s.action, data: s.data, expected: s.expected })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo crear el escenario sugerido.'); return; }
      setSuggestions(prev => prev?.filter(s => s !== suggestion) ?? null);
      await load();
    } catch { setError('No se pudo crear el escenario sugerido.'); }
    finally { setBusy(false); }
  }

  async function load() {
    setListError('');
    try {
      const [listRes, reqRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/scenarios`, { cache: 'no-store' }),
        fetch(`/api/projects/${projectId}/scenarios/requirements`, { cache: 'no-store' }),
      ]);
      if (listRes.ok) {
        const list: ScenarioListItem[] = await listRes.json();
        setChecked(previous => new Set(list.filter(item => items === null || previous.has(item.id)).map(item => item.id)));
        setItems(list);
      }
      else { setListError('No se pudo cargar el listado de escenarios.'); }
      if (reqRes.ok) setRequirements(await reqRes.json());
    } catch { setListError('No se pudo cargar el listado de escenarios.'); }
  }

  useEffect(() => { void load(); }, [projectId]);

  // Score del IPA para decidir si el CTA "Generar casos de prueba" está
  // habilitado. No bloqueamos el panel si falla la consulta: en ese caso el
  // CTA queda en gris explicándolo.
  useEffect(() => {
    if (!header?.active) return;
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/ipa`, { cache: 'no-store' });
        if (!active) return;
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        const ipa = payload?.ipa ?? payload;
        if (typeof ipa?.score === 'number') setIpaScore(ipa.score);
        setIpaBlockers(Array.isArray(ipa?.blockers) ? ipa.blockers.filter((blocker: unknown) => typeof blocker === 'string') : []);
        if (ipa?.status === 'ASSESSED' || ipa?.status === 'BLOCKED') setIpaStatus(ipa.status);
      } catch {/* CTA queda deshabilitado con mensaje explicando */}
    })();
    return () => { active = false; };
  }, [projectId, project.revision, header?.active, items]);

  async function selectTypesOnJob(jobId: string, types: TestTypeCode[]) {
    const response = await fetch(`/api/projects/${projectId}/automation/${jobId}/select`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ types }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message ?? 'No se pudo lanzar la generación.');
  }

  // Espera a que el job llegue a stage="generated" (fin de la Fase C). Igual
  // que waitForReview, hace polling cada 3s con timeout duro. El timeout es
  // más amplio porque los 6 agentes corren en paralelo y cada uno puede
  // tardar segundos contra Haiku.
  async function waitForGeneration(jobId: string, timeoutMs = 240_000): Promise<AutomationSummary | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const response = await fetch(`/api/projects/${projectId}/automation/${jobId}`, { cache: 'no-store' });
        if (response.ok) {
          const job: AutomationSummary = await response.json();
          if (job.stage === 'generated') return job;
          if (job.status === 'FAILED' || job.status === 'CANCELED') return job;
        }
      } catch {/* sigue reintentando hasta el timeout */}
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return null;
  }

  async function generate(documentTestTypes: TestTypeCode[]) {
    if (generating || !documentTestTypes.length) return;
    setGenerateNotice(''); setError('');
    setGenerating(true);
    try {
      // Siempre arrancamos un job fresco al clickear "Generar casos de
      // prueba". Reusar un job cacheado llevaba a enviar /select sobre un
      // AutomationJob ya avanzado (stage='generated') y el backend
      // respondía "La automatización no está en estado review-ready".
      if (!projectBaseUrl) {
        setGenerateNotice('Primero registra un entorno con URL base para que el agente sepa qué analizar.');
        return;
      }
      setGenerateNotice('Preparando generación con los requisitos verificables…');
      const create = await fetch(`/api/projects/${projectId}/automation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: projectBaseUrl, documentTestTypes }),
      });
      if (!create.ok) {
        const payload = await create.json().catch(() => ({}));
        setGenerateNotice('');
        setError(payload.message ?? 'No se pudo iniciar el análisis.');
        return;
      }
      const newJob: AutomationSummary = await create.json();

      await selectTypesOnJob(newJob.id, documentTestTypes);

      setGenerateNotice('Procesando: los agentes están generando los casos…');
      const done = await waitForGeneration(newJob.id);
      if (!done) {
        setGenerateNotice('La generación está tardando más de lo esperado. Los escenarios irán apareciendo según termine cada agente.');
      } else if (done.status === 'FAILED' || done.status === 'CANCELED') {
        setGenerateNotice('');
        const reason = done.status === 'CANCELED' ? 'La generación fue cancelada.'
          : generationErrors[done.errorCode ?? ''] ?? 'El servicio no pudo completar la generación. Consulta su registro.';
        setError(reason + ' Referencia de generación ' + done.id.slice(0, 8) + '.');
      } else {
        setGenerateNotice(documentTestTypes.length === 1 && documentTestTypes[0] === 'performance'
          ? 'Generación de Performance completada. Consulta el estado en Calidad.'
          : 'Generación completada. Revisa los escenarios abajo.');
      }
      await Promise.all([load(), loadQuality()]);
    } catch (err) {
      setGenerateNotice('');
      setError(err instanceof Error ? err.message : 'No se pudo comunicar con la API.');
    } finally { setGenerating(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          requirementId: requirementId || undefined,
          expectedResult: expectedResult.trim() || undefined,
          steps: [{ ordinal: 1, action: firstAction.trim() || 'Describe el primer paso' }],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo crear el escenario.'); return; }
      setTitle(''); setRequirementId(''); setExpectedResult(''); setFirstAction('');
      setShowForm(false);
      await load();
    } catch { setError('No se pudo crear el escenario.'); }
    finally { setBusy(false); }
  }

  function deleteSelected() {
    const scenarioIds = selected.map(item => item.id);
    if (deletionDisabled || !scenarioIds.length) return;
    const selection = scenarioIds.length === 1 ? 'el escenario seleccionado' : `los ${scenarioIds.length} escenarios seleccionados`;
    if (confirm(`¿Eliminar ${selection} y sus ejecuciones de forma definitiva?`)) void deleteScenarios(scenarioIds);
  }

  function deleteScenario(scenario: ScenarioListItem) {
    if (deletionDisabled) return;
    if (!confirm(`¿Eliminar el escenario «${scenario.title}» y sus ejecuciones?`)) return;
    if (!confirm(`¿Confirmas la eliminación definitiva de «${scenario.title}»? Esta acción es irreversible.`)) return;
    void deleteScenarios([scenario.id]);
  }

  async function deleteScenarios(scenarioIds: string[]) {
    setBusy(true); setError(''); setGenerateNotice('');
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios/delete-selected`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioIds }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message;
        throw new Error(message || 'No se pudieron eliminar los escenarios seleccionados.');
      }
      await load();
      setGenerateNotice(payload.deleted === 1 ? 'Se eliminó 1 escenario.' : `Se eliminaron ${payload.deleted} escenarios.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron eliminar los escenarios seleccionados.');
    } finally { setBusy(false); }
  }

  function hasRunnableSpec(item: ScenarioListItem) {
    if (isManualScenario(item)) return false;
    const spec = header?.specs[item.id];
    return !!item.playwright?.automationId
      || (spec?.signature === scenarioSpecSignature(item) && !!spec.automationId && !spec.error && spec.review.length === 0);
  }

  const selected = (items ?? []).filter(item => checked.has(item.id));
  const suite = selected.filter(item => !isManualScenario(item));
  const suiteReady = suite.length > 0 && selected.length === checked.size && suite.every(hasRunnableSpec);

  return <section className="scenarios-panel" aria-label="Gestión de escenarios">
    {header?.element && createPortal(<ProjectHeading project={project}
      summary={total !== null ? `${total} escenarios registrados. Consulta sus pasos y resultados.` : 'Consulta y prepara los escenarios del proyecto.'}
      actions={<>
        {canCreate && <button type="button" className="secondary" onClick={() => setShowForm(value => !value)}><Plus size={14} />{showForm ? 'Cancelar nuevo escenario' : 'Nuevo escenario'}</button>}
        {canDelete && !!items?.length && <button type="button" className="secondary"
          disabled={!selected.length || deletionDisabled}
          onClick={deleteSelected}>Eliminar escenarios</button>}
        <ScenarioExport projectId={project.id} projectName={project.name} scenarios={checked.size ? selected : items ?? []} />
        {canRun && runner && <button type="button" disabled={runner.stopping || (!runner.hasSuite && (!runnable || !suiteReady || !!listError))} onClick={() => runner.open(suite)}>
          {runner.hasSuite ? 'Ver suite' : `Ejecutar suite (${suite.length})`}<ArrowRight size={14} />
        </button>}
      </>} />, header.element)}

    <GenerateCta
      score={ipaScore}
      status={ipaStatus}
      blockers={ipaBlockers}
      projectStatus={project.status}
      canGenerate={canGenerate}
      threshold={IPA_AUTOMATION_THRESHOLD}
      generating={generating}
      onGenerate={() => setShowGenerationConfirmation(true)}
    />
    {showGenerationConfirmation && <ScenarioGenerationConfirmation projectId={projectId}
      onClose={() => setShowGenerationConfirmation(false)}
      onConfirm={types => { setShowGenerationConfirmation(false); void generate(types); }} />}
    {generateNotice && <p className="muted scenario-message" role="status">{generateNotice}</p>}
    {showForm && <form onSubmit={create} className="scenario-form scenario-create-form" aria-label="Nuevo escenario manual">
      <header><h2>Nuevo escenario manual</h2><p>Registra únicamente pasos y resultados definidos para tu aplicación.</p></header>
      <label>Título<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={300} autoFocus /></label>
      <label>Historia o requisito asociado<select value={requirementId} required onChange={event => setRequirementId(event.target.value)}>
        <option value="">Selecciona una historia o requisito</option>{requirements.map(requirement => <option key={requirement.id} value={requirement.id}>
          {requirement.externalKey ? `[${requirement.externalKey}] ` : ''}{requirement.title}</option>)}
      </select></label>
      <label>Resultado esperado (opcional)<textarea value={expectedResult} onChange={event => setExpectedResult(event.target.value)} maxLength={2000} rows={2} /></label>
      <label>Primer paso<input value={firstAction} onChange={event => setFirstAction(event.target.value)} maxLength={1000} />
        {(() => {
          // Aviso de duplicado: si el usuario está escribiendo un paso que ya
          // existe (normalización idéntica) en otro escenario, listamos los
          // escenarios que lo contienen para que decida reutilizar antes de
          // crear otro escenario con el mismo paso.
          const normalized = normalizeStepText(firstAction);
          if (!normalized || normalized.length < 3) return null;
          const matches = (items ?? []).filter(item => (item.steps ?? []).some(step => normalizeStepText(step.action) === normalized));
          if (!matches.length) return null;
          return <small className="scenario-duplicate-hint" role="status">Este paso ya aparece en: {matches.slice(0, 3).map(m => m.title).join(' · ')}{matches.length > 3 ? ` y ${matches.length - 3} más` : ''}.</small>;
        })()}
      </label>
      <div className="actions"><button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear escenario'}</button>
        <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancelar</button></div>
    </form>}
    {error && <p className="error scenario-message" role="alert">{error}</p>}
    {listError ? <div className="scenario-message" role="alert"><p className="error">{listError}</p>
      <button type="button" className="secondary" onClick={() => void load()}>Reintentar escenarios</button></div>
      : items === null ? <p className="scenario-message muted" role="status">Cargando escenarios…</p>
      : <ScenarioWorkspace key={total ? 'active' : 'empty'} projectId={projectId} items={[...items, ...qualityItems]} requirements={requirements} runs={runs} runsAvailable={runsAvailable} checked={checked} setChecked={setChecked} role={role}
        hasRunnableSpec={hasRunnableSpec} onRun={runnable && canRun && !runner?.stopping ? runner?.open : undefined}
        onDelete={canDelete ? deleteScenario : undefined} deletionDisabled={deletionDisabled}
        onChange={updated => setItems(current => current?.map(item => item.id !== updated.id ? item : {
          ...updated, playwright: scenarioSpecSignature(item) === scenarioSpecSignature(updated) ? item.playwright : null,
        }) ?? null)} />}
    {qualityError && <p className="scenario-history-warning" role="status">No se pudieron consultar las pruebas de calidad.{' '}
      <button type="button" className="secondary" onClick={() => void loadQuality()}>Reintentar consulta de calidad</button></p>}
    {runsWarning && <p className="scenario-history-warning" role="status">{runsWarning} <button type="button" className="secondary" onClick={() => void loadRuns()}>Reintentar historial</button></p>}
    {!runnable && <p className="scenario-history-warning">Para ejecutar necesitas un registro completo y un entorno autorizado.</p>}

  </section>;
}

function GenerateCta({ score, status, blockers, projectStatus, canGenerate, threshold, generating, onGenerate }: {
  score: number | null;
  status: 'ASSESSED' | 'BLOCKED' | null;
  blockers: string[];
  projectStatus: Project['status'];
  canGenerate: boolean;
  threshold: number;
  generating: boolean;
  onGenerate: () => void;
}) {
  const reasons: string[] = [];
  if (!canGenerate) reasons.push('Tu rol actual no permite generar escenarios.');
  if (projectStatus !== 'READY') reasons.push('El proyecto debe estar en estado READY (completar el registro en Datos).');
  if (status === 'BLOCKED') reasons.push(...(blockers.length ? blockers : ['Hay bloqueos por resolver en Datos.']));
  if (score === null) reasons.push('Todavía no hay una evaluación IPA consolidada.');
  else if (score < threshold) reasons.push(`Preparación actual: ${score}/100. Hace falta llegar al menos a ${threshold} aclarando los pendientes en Datos.`);
  const disabled = reasons.length > 0 || generating;
  const pctLabel = score === null ? '—' : `${score}/100`;

  return <GenerationCard title="Generar casos de prueba" disabled={disabled} action={<>
    <button type="button" disabled={disabled} onClick={onGenerate}
      aria-describedby={reasons.length ? 'generate-cta-reason' : undefined}>
      {generating ? 'Procesando…' : 'Generar casos de prueba'}
    </button>
    {reasons.length > 0 && <ul id="generate-cta-reason" className="generate-cta__reasons" role="status">
      {reasons.map(reason => <li key={reason}>{reason}</li>)}
    </ul>}
  </>}>
    <p className="muted">
      Revisa los tipos pendientes según la documentación marcada en Datos.
    </p>
    <p className="generate-cta__score">
      Preparación · <strong>{pctLabel}</strong> · umbral mínimo {threshold}
    </p>
  </GenerationCard>;
}

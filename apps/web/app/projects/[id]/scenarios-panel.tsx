'use client';

import { createPortal } from 'react-dom';
import { ArrowRight, Plus } from 'lucide-react';
import type { GenerationIssue, GenerationSummary, MissingGenerationRequirement } from '../../../../api/src/automation/generation-result';
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
import { TEST_TYPE_LABELS, type TestTypeCode } from '../document-client';
import { normalizeStepText } from './scenario-insights';
import { isManualScenario, type ScenarioRun } from './scenario-presentation';
import { ScenarioWorkspace } from './scenario-workspace';
import { qualityExecutionProblem } from './suite-quality-availability';

type AutomationSummary = {
  id: string; status: string; stage: string | null; errorCode?: string | null; createdAt: string;
  result?: { generation?: GenerationSummary } | null;
};

const generationIssues: Record<GenerationIssue, string> = {
  'ai-budget-exhausted': 'La cuota mensual de IA disponible es insuficiente para generar estos casos.',
  'ai-unavailable': 'La IA no estuvo disponible para generar casos.',
  'invalid-agent-response': 'La respuesta del agente no tenía el formato esperado.',
  'no-base-scenarios': 'Falta un escenario base vinculado y con una aserción.',
  'no-environment': 'Falta un entorno configurado para esta prueba.',
  'missing-traceability': 'Las propuestas no tenían un vínculo válido a una historia o requisito.',
  'missing-assertion': 'Las propuestas no tenían una comprobación observable.',
  'no-cases': 'El agente no devolvió casos para estos requisitos.',
  'agent-error': 'El agente no pudo producir casos válidos.',
  'coverage-changed': 'La prueba asociada cambió mientras se generaba el lote.'
};

function generationOutcomeDetails(generation: GenerationSummary | undefined, onlyFailingTypes: boolean) {
  const typesByIssue = new Map<GenerationIssue, string[]>();
  for (const outcome of generation?.outcomes ?? []) {
    if (outcome.created !== 0 || (onlyFailingTypes && !outcome.issue)) continue;
    const label = Object.hasOwn(TEST_TYPE_LABELS, outcome.type) ? TEST_TYPE_LABELS[outcome.type as TestTypeCode] : 'Tipo de prueba';
    const issue = outcome.issue ?? (outcome.usedFallback && outcome.type !== 'compatibility' ? 'ai-unavailable' : 'no-cases');
    const labels = typesByIssue.get(issue) ?? [];
    labels.push(label);
    typesByIssue.set(issue, labels);
  }
  return [...typesByIssue].map(([issue, labels]) => labels.join(', ') + ' · ' + generationIssues[issue]).join(' ');
}
const generationErrors: Record<string, string> = {
  'ipa-traceability-blocked': 'La generación está bloqueada por el IPA. Revisa la trazabilidad y los pendientes en Datos.',
  'document-analysis-changed': 'El análisis documental cambió. Vuelve a confirmar la generación.',
  'generation-worker-outdated': 'El proceso que atendió la solicitud necesita una actualización de Explorer. Vuelve a intentarlo cuando se actualice.',
  'generation-save-failed': 'El guardado del lote falló. Vuelve a intentar la generación de todos los tipos seleccionados.',
  'review-missing': 'Explorer no pudo usar el análisis de la solicitud. Verifica que Explorer y la aplicación estén en la misma versión.',
  'project-missing': 'El proyecto ya no está disponible para generar casos.',
  'selection-empty': 'La solicitud quedó sin tipos de prueba. Abre de nuevo la confirmación.',
  'automation-crashed': 'El servicio de generación encontró un error interno. Consulta su registro.',
};

export function ScenariosPanel({ project, role }: { project: Project; role?: OrgRole }) {
  const canCreate = can(role, 'scenario.create');
  const canDelete = can(role, 'scenario.delete');
  const canRun = can(role, 'run.execute');
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
  const [ipaScore, setIpaScore] = useState<number | null>(null);
  const [ipaBlockers, setIpaBlockers] = useState<string[]>([]);
  const [ipaStatus, setIpaStatus] = useState<'ASSESSED' | 'BLOCKED' | null>(null);
  const [showGenerationConfirmation, setShowGenerationConfirmation] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateNotice, setGenerateNotice] = useState('');
  const [missingCoverage, setMissingCoverage] = useState<MissingGenerationRequirement[]>([]);
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

  async function load() {
    setListError('');
    try {
      const [listRes, reqRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/scenarios`, { cache: 'no-store' }),
        fetch(`/api/projects/${projectId}/scenarios/requirements`, { cache: 'no-store' }),
      ]);
      if (listRes.ok) {
        const list: ScenarioListItem[] = await listRes.json();
        setChecked(previous => new Set([
          ...list.filter(item => items === null || previous.has(item.id)).map(item => item.id),
          ...[...previous].filter(id => id.includes(':')),
        ]));
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
  async function waitForGeneration(jobId: string, timeoutMs = 15 * 60_000): Promise<AutomationSummary | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const response = await fetch(`/api/projects/${projectId}/automation/${jobId}`, { cache: 'no-store' });
        if (response.ok) {
          const job: AutomationSummary = await response.json();
          if (job.stage === 'generated') return job;
          if (job.status === 'COMPLETED' && job.stage === 'review-ready') {
            return { ...job, status: 'FAILED', errorCode: 'generation-worker-outdated' };
          }
          if (job.status === 'FAILED' || job.status === 'CANCELED') return job;
        }
      } catch {/* sigue reintentando hasta el timeout */}
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return null;
  }

  async function generate(documentTestTypes: TestTypeCode[]) {
    if (generating || !documentTestTypes.length) return;
    setGenerateNotice(''); setError(''); setMissingCoverage([]);
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

      setGenerateNotice('Generando casos por historia y verificando su cobertura…');
      const done = await waitForGeneration(newJob.id);
      await Promise.all([load(), loadQuality()]);
      if (!done) {
        setGenerateNotice('La generación sigue en curso. Los casos se publicarán juntos después de verificar la cobertura.');
        return;
      }

      const reference = 'Referencia de generación ' + done.id.slice(0, 8) + '.';
      const generation = done.result?.generation;
      const missing = generation?.coverage?.missing ?? [];
      const incomplete = done.errorCode === 'generation-incomplete' || done.errorCode === 'generation-coverage-changed';
      const details = generationOutcomeDetails(generation, incomplete);
      if (missing.length || incomplete || done.errorCode === 'generation-empty'
        || (done.status === 'COMPLETED' && generation?.totalCreated === 0 && !generation.coverage)) {
        setGenerateNotice('');
        setMissingCoverage(missing);
        const message = missing.length
          ? 'No se guardó el lote. Quedaron historias o requisitos sin una prueba válida.'
          : incomplete ? 'No se guardó el lote porque faltaron casos válidos para uno o más tipos.' : 'No se guardó ningún escenario.';
        setError([message, details, reference].filter(Boolean).join(' '));
      } else if (done.status === 'FAILED' || done.status === 'CANCELED') {
        setGenerateNotice('');
        const reason = done.status === 'CANCELED' ? 'La generación fue cancelada.'
          : generationErrors[done.errorCode ?? ''] ?? 'El servicio no pudo completar la generación. Consulta su registro.';
        setError(reason + ' ' + reference);
      } else if (generation && generation.totalCreated > 0) {
        const count = generation.totalCreated;
        const saved = count === 1 ? 'Se guardó 1 escenario.' : 'Se guardaron ' + count + ' escenarios.';
        const covered = generation.coverage?.total;
        setGenerateNotice([saved, covered ? 'Cobertura verificada para ' + covered + ' historias o requisitos del alcance.' : '', details, details ? reference : ''].filter(Boolean).join(' '));
      } else if (generation?.coverage?.total) {
        setGenerateNotice('Las historias y requisitos del alcance ya tienen una prueba asociada.');
      } else {
        setGenerateNotice('El proceso terminó sin informar cuántos escenarios se guardaron. ' + reference);
      }
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
  const suiteReady = suite.length > 0 && suite.every(hasRunnableSpec);
  const qualitySuite = qualityItems.filter(item => checked.has(item.id));
  const runnableQualityCount = qualitySuite.filter(item => !qualityExecutionProblem(item, project, role)).length;
  const browserSuite = runnableQualityCount ? suite.filter(item => runnable && !listError && hasRunnableSpec(item)) : suite;
  const suiteCount = browserSuite.length + runnableQualityCount;
  const canOpenSuite = project.status === 'READY' && (runnableQualityCount > 0 || (runnable && suiteReady && !listError));

  return <section className="scenarios-panel" aria-label="Gestión de escenarios">
    {header?.element && createPortal(<ProjectHeading project={project}
      summary={total !== null ? `${total} escenarios registrados. Consulta sus pasos y resultados.` : 'Consulta y prepara los escenarios del proyecto.'}
      actions={<>
        {canCreate && <button type="button" className="secondary" onClick={() => setShowForm(value => !value)}><Plus size={14} />{showForm ? 'Cancelar nuevo escenario' : 'Nuevo escenario'}</button>}
        {canDelete && !!items?.length && <button type="button" className="secondary"
          disabled={!selected.length || deletionDisabled}
          onClick={deleteSelected}>Eliminar escenarios</button>}
        <ScenarioExport projectId={project.id} projectName={project.name} scenarios={checked.size ? selected : items ?? []} />
        {canRun && runner && <button type="button" disabled={runner.stopping || (!runner.hasSuite && !canOpenSuite)} onClick={() => runner.open(runnable && !listError ? browserSuite : [], qualitySuite, {
          scenarios: runnable && !listError ? (items ?? []).filter(hasRunnableSpec) : [],
          qualityScenarios: qualityItems,
        })}>
          {runner.hasSuite ? 'Ver suite' : `Ejecutar suite (${suiteCount})`}<ArrowRight size={14} />
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
    {error && <div className="error scenario-message" role="alert">
      {error}
      {missingCoverage.length > 0 && <details>
        <summary>Ver historias y requisitos sin prueba ({missingCoverage.length})</summary>
        <ul>{missingCoverage.map(item => <li key={item.id}>
          {item.externalKey && <strong>{item.externalKey} · </strong>}{item.title}
          {' · '}{generationIssues[item.issue]}
        </li>)}</ul>
      </details>}
    </div>}
    {listError ? <div className="scenario-message" role="alert"><p className="error">{listError}</p>
      <button type="button" className="secondary" onClick={() => void load()}>Reintentar escenarios</button></div>
      : items === null ? <p className="scenario-message muted" role="status">Cargando escenarios…</p>
      : <ScenarioWorkspace key={total ? 'active' : 'empty'} projectId={projectId} items={[...items, ...qualityItems]} requirements={requirements} runs={runs} runsAvailable={runsAvailable} checked={checked} setChecked={setChecked} role={role}
        hasRunnableSpec={item => item.quality ? !qualityExecutionProblem(item, project, role) : runnable && hasRunnableSpec(item)}
        onRun={runnable && canRun && !runner?.stopping ? runner?.open : undefined}
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

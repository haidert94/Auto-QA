'use client';

import { createPortal } from 'react-dom';
import { ArrowRight, Plus, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type { ScenarioListItem } from './scenario-card';
import { scenarioRunEnvironmentError, type Project } from '../onboarding';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { scenarioSpecSignature } from './automation-export';
import { GenerationCard } from './generation-card';
import { IPA_AUTOMATION_THRESHOLD } from './ipa-hero';
import { ProjectHeading } from './project-heading';
import { useScenarioHeader, useScenarioSuite } from './project-tabs';
import { ScenarioExport } from './scenario-export';
import { normalizeStepText } from './scenario-insights';
import { isManualScenario, type ScenarioRun } from './scenario-presentation';
import { ScenarioWorkspace } from './scenario-workspace';

type RequirementOption = { id: string; title: string; externalKey: string | null };

type TestType = { code: string; label: string; description: string; available: boolean };
type AutomationSummary = { id: string; status: string; stage: string | null; createdAt: string };

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
  const [types, setTypes] = useState<TestType[] | null>(null);
  const [typesError, setTypesError] = useState('');
  const [ipaScore, setIpaScore] = useState<number | null>(null);
  const [ipaStatus, setIpaStatus] = useState<'ASSESSED' | 'BLOCKED' | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [latestJob, setLatestJob] = useState<AutomationSummary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateNotice, setGenerateNotice] = useState('');

  useEffect(() => { updateCount?.(items?.length ?? null); }, [updateCount, items?.length]);

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
        if (ipa?.status === 'ASSESSED' || ipa?.status === 'BLOCKED') setIpaStatus(ipa.status);
      } catch {/* CTA queda deshabilitado con mensaje explicando */}
    })();
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [typesRes, jobsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/automation/types`, { cache: 'no-store' }),
          fetch(`/api/projects/${projectId}/automation`, { cache: 'no-store' }),
        ]);
        if (!active) return;
        if (typesRes.ok) {
          const list: TestType[] = await typesRes.json();
          setTypes(list);
          // Preseleccionamos todos los disponibles para que el botón funcione
          // al primer intento sin obligar al usuario a marcar uno por uno.
          setSelectedTypes(new Set(list.filter(t => t.available).map(t => t.code)));
        } else {
          // Render explícito: antes el panel se quedaba en "cargando…" para
          // siempre si el plan no incluye AI_DOCUMENT_ANALYSIS (403) o si la
          // API caía. Muestra el motivo real que devuelve el backend.
          const payload = await typesRes.json().catch(() => ({}));
          const message = typesRes.status === 403
            ? 'Tu plan no incluye generación de escenarios con IA. Actualiza para habilitar los agentes.'
            : (payload.message ?? `No se pudo cargar los tipos (HTTP ${typesRes.status}).`);
          setTypesError(Array.isArray(message) ? message.join(' · ') : message);
          setTypes([]);
        }
        if (jobsRes.ok) {
          const jobs: AutomationSummary[] = await jobsRes.json();
          setLatestJob(jobs[0] ?? null);
        }
      } catch (error) {
        if (!active) return;
        setTypesError(error instanceof Error ? error.message : 'No se pudo comunicar con la API de AutoQA.');
        setTypes([]);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  function toggleType(code: string) {
    setSelectedTypes(previous => {
      const next = new Set(previous);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  // Espera a que el job llegue a stage="review-ready". Hace polling cada 3s
  // con un timeout duro: si el worker no está corriendo, la UI no se queda
  // girando indefinidamente.
  async function waitForReview(jobId: string, timeoutMs = 120_000): Promise<AutomationSummary | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const response = await fetch(`/api/projects/${projectId}/automation/${jobId}`, { cache: 'no-store' });
        if (response.ok) {
          const job: AutomationSummary = await response.json();
          if (job.stage === 'review-ready') return job;
          if (job.status === 'FAILED' || job.status === 'CANCELED') return null;
        }
      } catch {/* sigue reintentando hasta el timeout */}
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return null;
  }

  async function selectTypesOnJob(jobId: string) {
    const response = await fetch(`/api/projects/${projectId}/automation/${jobId}/select`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ types: Array.from(selectedTypes) }),
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
          if (job.status === 'FAILED' || job.status === 'CANCELED') return null;
        }
      } catch {/* sigue reintentando hasta el timeout */}
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return null;
  }

  async function generate() {
    setGenerateNotice(''); setError('');
    if (selectedTypes.size === 0) {
      setGenerateNotice('Selecciona al menos un tipo de prueba.');
      return;
    }
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
      setGenerateNotice('Analizando documentos y preparando el proyecto…');
      const create = await fetch(`/api/projects/${projectId}/automation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: projectBaseUrl }),
      });
      if (!create.ok) {
        const payload = await create.json().catch(() => ({}));
        setError(payload.message ?? 'No se pudo iniciar el análisis.');
        return;
      }
      const newJob: AutomationSummary = await create.json();
      setLatestJob(newJob);
      let job = newJob;

      // Esperar a que el worker termine el análisis.
      const ready = await waitForReview(newJob.id);
      if (!ready) {
        setGenerateNotice('El worker no respondió a tiempo. Verifica que el Explorer esté desplegado y vuelve a intentar.');
        return;
      }
      job = ready;
      setLatestJob(ready);

      // Paso 3: con el job en review-ready, encolamos los tipos marcados.
      setGenerateNotice('Análisis listo. Encolando agentes de generación…');
      await selectTypesOnJob(job.id);

      // Paso 4: esperar que los 6 agentes terminen. Durante este tiempo el
      // botón sigue deshabilitado con "Procesando…" para que el usuario no
      // dispare un nuevo job sobre uno todavía corriendo.
      setGenerateNotice('Procesando: los agentes están generando los casos…');
      const done = await waitForGeneration(job.id);
      if (!done) {
        setGenerateNotice('La generación está tardando más de lo esperado. Los escenarios irán apareciendo según termine cada agente.');
      } else {
        setGenerateNotice('Generación completada. Revisa los escenarios abajo.');
      }
      await load();
    } catch (err) {
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

  async function deleteSelected() {
    const scenarioIds = selected.map(item => item.id);
    if (!scenarioIds.length) return;
    const selection = scenarioIds.length === 1 ? 'el escenario seleccionado' : `los ${scenarioIds.length} escenarios seleccionados`;
    if (!confirm(`¿Eliminar ${selection} y sus ejecuciones de forma definitiva?`)) return;
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
      summary={items ? `${items.length} escenarios registrados. Consulta sus pasos, requisitos asociados y resultados de ejecución.` : 'Consulta y prepara los escenarios del proyecto.'}
      actions={<>
        {canCreate && <button type="button" className="secondary" onClick={() => setShowForm(value => !value)}><Plus size={14} />{showForm ? 'Cancelar nuevo escenario' : 'Nuevo escenario'}</button>}
        {canDelete && !!items?.length && <button type="button" className="secondary"
          disabled={!selected.length || busy || generating || !!listError || runner?.suiteRunning || runner?.stopping}
          onClick={() => void deleteSelected()}>Eliminar escenarios</button>}
        <ScenarioExport projectId={project.id} projectName={project.name} scenarios={checked.size ? selected : items ?? []} />
        {canRun && runner && <button type="button" disabled={runner.stopping || (!runner.hasSuite && (!runnable || !suiteReady || !!listError))} onClick={() => runner.open(suite)}>
          {runner.hasSuite ? 'Ver suite' : `Ejecutar suite (${suite.length})`}<ArrowRight size={14} />
        </button>}
      </>} />, header.element)}

    <GenerateCta
      score={ipaScore}
      status={ipaStatus}
      projectStatus={project.status}
      canGenerate={canGenerate}
      availableTypes={types?.filter(t => t.available).length ?? 0}
      threshold={IPA_AUTOMATION_THRESHOLD}
      generating={generating}
      onGenerate={() => void generate()}
    />
    {generateNotice && <p className="muted scenario-message" role="status">{generateNotice}</p>}
    {showForm && <form onSubmit={create} className="scenario-form scenario-create-form" aria-label="Nuevo escenario manual">
      <header><h2>Nuevo escenario manual</h2><p>Registra únicamente pasos y resultados definidos para tu aplicación.</p></header>
      <label>Título<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={300} autoFocus /></label>
      <label>Requisito asociado (opcional)<select value={requirementId} onChange={event => setRequirementId(event.target.value)}>
        <option value="">— Sin requisito —</option>{requirements.map(requirement => <option key={requirement.id} value={requirement.id}>
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
      : <ScenarioWorkspace key={items.length ? 'active' : 'empty'} projectId={projectId} items={items} runs={runs} runsAvailable={runsAvailable} checked={checked} setChecked={setChecked} role={role}
        hasRunnableSpec={hasRunnableSpec} onRun={runnable && canRun && !runner?.stopping ? runner?.open : undefined}
        onChange={updated => setItems(current => current?.map(item => item.id !== updated.id ? item : {
          ...updated, playwright: scenarioSpecSignature(item) === scenarioSpecSignature(updated) ? item.playwright : null,
        }) ?? null)} />}
    {runsWarning && <p className="scenario-history-warning" role="status">{runsWarning} <button type="button" className="secondary" onClick={() => void loadRuns()}>Reintentar historial</button></p>}
    {!runnable && <p className="scenario-history-warning">Para ejecutar necesitas un registro completo y un entorno autorizado.</p>}

    {/* El bloque "Generar y sugerir escenarios con IA" se removió: ahora
       el CTA de arriba dispara la generación con todos los tipos del plan
       y no requiere marcar cada uno. El selector de "Sugerir desde
       requisito" también sale: duplicaba una ruta IA parcial que el
       pipeline del CTA ya cubre. Si en el futuro hace falta un modo
       avanzado, se reintroduce como vista aparte. */}
  </section>;
}

function GenerateCta({ score, status, projectStatus, canGenerate, availableTypes, threshold, generating, onGenerate }: {
  score: number | null;
  status: 'ASSESSED' | 'BLOCKED' | null;
  projectStatus: Project['status'];
  canGenerate: boolean;
  availableTypes: number;
  threshold: number;
  generating: boolean;
  onGenerate: () => void;
}) {
  const reasons: string[] = [];
  if (!canGenerate) reasons.push('Tu rol actual no permite generar escenarios.');
  if (projectStatus !== 'READY') reasons.push('El proyecto debe estar en estado READY (completar el registro en Datos).');
  if (status === 'BLOCKED') reasons.push('Hay bloqueos de autorización o alcance por resolver.');
  if (score === null) reasons.push('Todavía no hay una evaluación IPA consolidada.');
  else if (score < threshold) reasons.push(`Preparación actual: ${score}/100. Hace falta llegar al menos a ${threshold} aclarando los pendientes en Datos.`);
  if (availableTypes === 0) reasons.push('Tu plan no habilita tipos de prueba para generar.');
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
      Un solo clic crea los casos para los <strong>{availableTypes}</strong> tipos habilitados por tu plan, usando los requisitos ya analizados.
    </p>
    <p className="generate-cta__score">
      Preparación · <strong>{pctLabel}</strong> · umbral mínimo {threshold}
    </p>
  </GenerationCard>;
}

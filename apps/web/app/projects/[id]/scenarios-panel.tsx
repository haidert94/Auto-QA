'use client';

import { createPortal } from 'react-dom';
import { ArrowRight, Code2, Plus, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type { ScenarioListItem } from './scenario-card';
import type { Project } from '../onboarding';
import { ProjectHeading } from './project-heading';
import { useScenarioHeader } from './project-tabs';
import { featureText, type ScenarioRun } from './scenario-presentation';
import { ScenarioRunDialog } from './scenario-run-dialog';
import { ScenarioWorkspace } from './scenario-workspace';

type RequirementOption = { id: string; title: string; externalKey: string | null };

type TestType = { code: string; label: string; description: string; available: boolean };
type AutomationSummary = { id: string; status: string; stage: string | null; createdAt: string };

export function ScenariosPanel({ project }: { project: Project }) {
  const projectId = project.id;
  const projectBaseUrl = project.environments.find(environment => environment.authorizationConfirmed)?.baseUrl ?? null;
  const environments = project.environments.filter(environment => environment.authorizationConfirmed && environment.readOnly);
  const runnable = project.status === 'READY' && environments.length > 0;
  const header = useScenarioHeader();
  const updateCount = header?.setCount;
  const [items, setItems] = useState<ScenarioListItem[] | null>(null);
  const [listError, setListError] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [runs, setRuns] = useState<ScenarioRun[]>([]);
  const [runsAvailable, setRunsAvailable] = useState(false);
  const [runsWarning, setRunsWarning] = useState('');
  const [runSelection, setRunSelection] = useState<ScenarioListItem[] | null>(null);
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
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  function exportFeature() {
    const exported = (items ?? []).filter(item => checked.size === 0 || checked.has(item.id));
    const url = URL.createObjectURL(new Blob([featureText(project.name, exported)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'autoqa-escenarios.feature'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
        }
        if (jobsRes.ok) {
          const jobs: AutomationSummary[] = await jobsRes.json();
          setLatestJob(jobs[0] ?? null);
        }
      } catch {/* UI muestra "cargando opciones" si falta */}
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

  async function generate() {
    setGenerateNotice(''); setError('');
    if (selectedTypes.size === 0) {
      setGenerateNotice('Selecciona al menos un tipo de prueba.');
      return;
    }
    setGenerating(true);
    try {
      let job = latestJob;

      // Paso 1: si no hay un job listo para seleccionar tipos, lo creamos
      // usando la URL del entorno autorizado. El worker correrá el análisis
      // documental y pondrá el job en "review-ready".
      if (!job || job.stage !== 'review-ready') {
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
        job = newJob;

        // Paso 2: esperar a que el worker termine el análisis.
        const ready = await waitForReview(newJob.id);
        if (!ready) {
          setGenerateNotice('El worker no respondió a tiempo. Verifica que el Explorer esté desplegado y vuelve a intentar.');
          return;
        }
        job = ready;
        setLatestJob(ready);
      }

      // Paso 3: con el job en review-ready, encolamos los tipos marcados.
      setGenerateNotice('Análisis listo. Encolando agentes de generación…');
      await selectTypesOnJob(job.id);
      setGenerateNotice('Generación encolada. Los escenarios aparecerán aquí a medida que el worker termine cada agente.');
      setTimeout(() => void load(), 2000);
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

  return <section className="scenarios-panel" aria-label="Gestión de escenarios">
    {header?.element && createPortal(<ProjectHeading project={project}
      summary={items ? `${items.length} escenarios registrados. Consulta sus pasos, requisitos asociados y resultados de ejecución.` : 'Consulta y prepara los escenarios del proyecto.'}
      actions={<>
        <button type="button" className="secondary" onClick={() => setShowForm(value => !value)}><Plus size={14} />{showForm ? 'Cancelar nuevo escenario' : 'Nuevo escenario'}</button>
        <button type="button" className="secondary" onClick={exportFeature} disabled={!items?.length} title="Exportar seleccionados, o todos si no hay selección"><Code2 size={14} />Exportar feature</button>
        <button type="button" disabled={!runnable || !checked.size || !!listError} onClick={() => setRunSelection((items ?? []).filter(item => checked.has(item.id)))}>
          Ejecutar suite ({checked.size})<ArrowRight size={14} />
        </button>
      </>} />, header.element)}

    {showForm && <form onSubmit={create} className="scenario-form scenario-create-form" aria-label="Nuevo escenario manual">
      <header><h2>Nuevo escenario manual</h2><p>Registra únicamente pasos y resultados definidos para tu aplicación.</p></header>
      <label>Título<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={300} autoFocus /></label>
      <label>Requisito asociado (opcional)<select value={requirementId} onChange={event => setRequirementId(event.target.value)}>
        <option value="">— Sin requisito —</option>{requirements.map(requirement => <option key={requirement.id} value={requirement.id}>
          {requirement.externalKey ? `[${requirement.externalKey}] ` : ''}{requirement.title}</option>)}
      </select></label>
      <label>Resultado esperado (opcional)<textarea value={expectedResult} onChange={event => setExpectedResult(event.target.value)} maxLength={2000} rows={2} /></label>
      <label>Primer paso<input value={firstAction} onChange={event => setFirstAction(event.target.value)} maxLength={1000} /></label>
      <div className="actions"><button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear escenario'}</button>
        <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancelar</button></div>
    </form>}
    {error && <p className="error scenario-message" role="alert">{error}</p>}
    {listError ? <div className="scenario-message" role="alert"><p className="error">{listError}</p>
      <button type="button" className="secondary" onClick={() => void load()}>Reintentar escenarios</button></div>
      : items === null ? <p className="scenario-message muted" role="status">Cargando escenarios…</p>
      : <ScenarioWorkspace projectId={projectId} items={items} runs={runs} runsAvailable={runsAvailable} checked={checked} setChecked={setChecked}
        onRun={runnable ? scenarios => setRunSelection(scenarios) : undefined}
        onChange={updated => setItems(current => current?.map(item => item.id === updated.id ? updated : item) ?? null)} />}
    {runsWarning && <p className="scenario-history-warning" role="status">{runsWarning} <button type="button" className="secondary" onClick={() => void loadRuns()}>Reintentar historial</button></p>}
    {!runnable && <p className="scenario-history-warning">Para ejecutar necesitas un registro completo y un entorno autorizado de solo lectura.</p>}
    {runSelection && <ScenarioRunDialog projectId={projectId} scenarios={runSelection} environments={environments}
      onClose={() => setRunSelection(null)} onQueued={() => { void loadRuns(); void load(); }} />}

    <details className="scenario-ai-tools"><summary><Sparkles size={14} />Generar y sugerir escenarios con IA</summary>
    <section className="generator">
      <h3>Generar escenarios con IA</h3>
      {types === null
        ? <p className="muted">Cargando tipos disponibles…</p>
        : <>
          <ul className="type-select">
            {types.map(t => <li key={t.code} className={t.available ? '' : 'locked'}>
              <label title={t.available ? t.description : 'Requiere un plan superior'}>
                <input type="checkbox" disabled={!t.available}
                  checked={selectedTypes.has(t.code)}
                  onChange={() => toggleType(t.code)} />
                <span>
                  <strong>{t.label}</strong>
                  {!t.available && <span className="badge badge-canceled" style={{ marginLeft: 6 }}>Requiere plan superior</span>}
                  <br/>
                  <small className="muted">{t.description}</small>
                </span>
              </label>
            </li>)}
          </ul>
          <div className="actions">
            <button type="button" onClick={generate} disabled={generating || selectedTypes.size === 0}>
              {generating ? 'Trabajando…' : 'Generar escenarios'}
            </button>
            {!projectBaseUrl && <small className="muted">
              Registra un entorno con URL base antes de generar.
            </small>}
          </div>
          {generateNotice && <p className="muted" role="status">{generateNotice}</p>}
          <p className="muted"><small>
            Al pulsar, AutoQA analiza los documentos del proyecto (si no se ha hecho ya) y luego
            los agentes generan escenarios para los tipos marcados. Puede tardar unos minutos.
          </small></p>
        </>}
    </section>

    <label>Requisito para sugerencias<select value={requirementId} onChange={event => setRequirementId(event.target.value)}>
      <option value="">Selecciona un requisito</option>{requirements.map(requirement => <option key={requirement.id} value={requirement.id}>{requirement.title}</option>)}
    </select></label>
    <div className="actions">
      <button type="button" className="secondary" onClick={suggest} disabled={suggesting || !requirementId}>
        {suggesting ? 'Pensando…' : 'Sugerir desde requisito'}
      </button>
    </div>

    {suggestions && <section className="ai-suggestions">
      <header>
        <strong>Propuesta IA ({suggestions.length})</strong>
        <span className="muted">{suggestionMeta?.model}{suggestionMeta?.usedFallback ? ' · fallback (plan sin IA)' : ''}</span>
        <button type="button" className="secondary" onClick={() => setSuggestions(null)}>Descartar todas</button>
      </header>
      {suggestions.length === 0
        ? <p className="muted">La IA no devolvió sugerencias utilizables para este requisito.</p>
        : <ul className="ai-suggestions-list">
          {suggestions.map((s, i) => <li key={i}>
            <div className="suggestion-head">
              <strong>{s.title}</strong>
              <button type="button" onClick={() => createFromSuggestion(s)} disabled={busy}>Crear este</button>
            </div>
            {s.expectedResult && <p className="muted">Esperado: {s.expectedResult}</p>}
            <ol className="suggestion-steps">
              {s.steps.map((step, j) => <li key={j}>
                <code>{step.action}</code>
                {step.data && <span className="muted"> · dato: {step.data}</span>}
              </li>)}
            </ol>
          </li>)}
        </ul>}
    </section>}

    </details>
  </section>;
}

'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowRight, FileCode2, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { scenarioRunEnvironmentError, type Project } from '../onboarding';
import type { ScenarioListItem } from './scenario-card';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { GenerationCard } from './generation-card';
import { QualityResultsLink } from './quality-results-link';
import { ProjectHeading } from './project-heading';
import { useAutomationHeader, useScenarioQuality, useScenarioSuite } from './project-tabs';
import { AutomationRunStatus } from './automation-run-status';
import { qualityExecutionProblem } from './suite-quality-availability';
import { scenarioSpecSignature, specFilename, specPath, type GeneratedSpec } from './automation-export';
import { isManualScenario, matchesScenarioQuery } from './scenario-presentation';
import { COMPATIBILITY_SCENARIO_TAG } from '../../../../api/src/scenarios/scenario-tags';
import { ScenarioListToolbar, ScenarioVisibleSelection } from './scenario-list-toolbar';
import { ScenarioPagination, useScenarioPagination } from './scenario-pagination';

const AUTOMATION_STATUS_LABELS = {
  all: 'Todos',
  quality: 'Calidad',
  pending: 'Pendiente',
  generating: 'Generando…',
  generated: 'Generado',
  review: 'Requiere revisión',
  error: 'Error',
} as const;

type AutomationFilter = keyof typeof AUTOMATION_STATUS_LABELS;
type QualityOrigin = NonNullable<ScenarioListItem['quality']>;
type PreparationOutcome = 'saved' | 'review' | 'error';

async function fetchQualityFile(path: string, method: 'GET' | 'POST') {
  const response = await fetch(path, { method, cache: 'no-store', signal: AbortSignal.timeout(method === 'POST' ? 35000 : 15000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message;
    throw new Error(typeof message === 'string' ? message : 'No se pudo obtener el archivo.');
  }
  return payload;
}

function codeStatus(scenario: ScenarioListItem, spec: GeneratedSpec | undefined, generating: boolean): Exclude<AutomationFilter, 'all' | 'quality'> {
  if (generating) return 'generating';
  if (spec?.automationId || scenario.playwright) return 'generated';
  if (spec?.error) return 'error';
  return spec?.review.length ? 'review' : 'pending';
}

function visibleScenarioTags(tags: string[] = []) {
  const type = [COMPATIBILITY_SCENARIO_TAG, '@mobile', '@funcional'].find(tag => tags.includes(tag));
  return (type ? [type, ...tags.filter(tag => tag !== type)] : tags).slice(0, 2);
}

function reviewCode(scenario: ScenarioListItem, code: string, hasAssertions?: boolean) {
  const reasons = [];
  if (!scenario.steps?.length) reasons.push('Sin pasos definidos');
  if (/^\s*\/\/ TODO\b/m.test(code)) reasons.push('Contiene pasos por completar');
  const executable = code.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  if (!(hasAssertions ?? /\bexpect\s*\(/.test(executable))) reasons.push('No se detectan aserciones activas');
  return reasons;
}

export function AutomationPanel({ project, role }: { project: Project; role?: OrgRole }) {
  const canGenerate = can(role, 'automation.generate');
  const canRunSuite = can(role, 'run.execute');
  const header = useAutomationHeader();
  const runner = useScenarioSuite();
  const { items: qualityItems, error: qualityError, reload: loadQuality, updateAutomation: updateQualityAutomation } = useScenarioQuality();
  const hasQuality = qualityItems.length > 0;
  const listTitle = hasQuality ? 'Pruebas de automatización' : 'Escenarios para Playwright';
  const specs = header?.specs ?? {};
  const setSpecs = header?.setSpecs;
  const [scenarios, setScenarios] = useState<ScenarioListItem[] | null>(null);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qualitySelection, setQualitySelection] = useState<Set<string> | null>(null);
  const [qualityErrors, setQualityErrors] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [statusFilter, setStatusFilter] = useState<AutomationFilter>('all');
  const listRef = useRef<ScenarioListItem[]>([]);
  const specsRef = useRef<Record<string, GeneratedSpec>>({});
  const requests = useRef(new Map<string, Promise<GeneratedSpec>>());
  const mounted = useRef(true);
  const environments = project.environments.filter(environment => !scenarioRunEnvironmentError(environment));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!header?.active) return;
    const controller = new AbortController();
    setListError('');
    fetch(`/api/projects/${project.id}/scenarios`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('No se pudo cargar la lista de automatización.');
        const items: ScenarioListItem[] = await response.json();
        const list = items.filter(item => !isManualScenario(item));
        if (controller.signal.aborted) return;
        const firstLoad = listRef.current.length === 0;
        listRef.current = list;
        const current = Object.fromEntries(list.flatMap(scenario => {
          const spec = specsRef.current[scenario.id];
          if (!spec || spec.error || spec.signature !== scenarioSpecSignature(scenario)
            || (spec.automationId ?? null) !== (scenario.playwright?.automationId ?? null)) return [];
          return [[scenario.id, spec]];
        }));
        specsRef.current = current; setSpecs?.(current);
        setSelected(previous => new Set(list.filter(item => firstLoad || previous.has(item.id)).map(item => item.id)));
        setScenarios(list);
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setListError(reason instanceof Error ? reason.message : 'No se pudo consultar la automatización.'); });
    return () => controller.abort();
  }, [project.id, header?.active, refresh, setSpecs]);

  const generateOne = useCallback((scenario: ScenarioListItem, mode: 'prepare' | 'preview'): Promise<GeneratedSpec> => {
    const currentSignature = scenarioSpecSignature(scenario);
    const cached = specsRef.current[scenario.id];
    const useAgent = mode === 'prepare';
    if (cached?.signature === currentSignature && !cached.error && (!useAgent || cached.automationId)) {
      return Promise.resolve(cached);
    }
    const requestKey = JSON.stringify([scenario.id, currentSignature, scenario.playwright?.automationId, useAgent]);
    const pending = requests.current.get(requestKey);
    if (pending) return pending;
    if (useAgent) setGenerating(previous => new Set(previous).add(scenario.id));
    const task = (async () => {
      let result: GeneratedSpec = { scenarioId: scenario.id, title: scenario.title, filename: '', code: '', signature: currentSignature, review: [] };
      try {
        const response = await fetch(`/api/projects/${project.id}/scenarios/${scenario.id}/playwright`, {
          method: useAgent ? 'POST' : 'GET', cache: 'no-store',
          signal: AbortSignal.timeout(useAgent ? 65000 : 15000),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message ?? 'No se pudo generar este archivo.');
        if (typeof payload.code !== 'string' || !payload.code.trim() || typeof payload.filename !== 'string') throw new Error('La API no devolvió un archivo de código válido.');
        const automationId = typeof payload.automationId === 'string' ? payload.automationId : null;
        const review = reviewCode(scenario, payload.code, typeof payload.hasAssertions === 'boolean' ? payload.hasAssertions : undefined);
        if (useAgent && !automationId && !review.length) review.push('La automatización no se guardó');
        result = {
          ...result,
          code: payload.code,
          filename: specFilename(payload.filename, scenario.id),
          review,
          automationId,
          notice: typeof payload.notice === 'string' ? payload.notice : undefined,
        };
      } catch (reason) { result.error = reason instanceof Error ? reason.message : 'No se pudo generar este archivo.'; }
      const latest = listRef.current.find(item => item.id === scenario.id);
      if (mounted.current && latest && scenarioSpecSignature(latest) === currentSignature
        && (useAgent || latest.playwright?.automationId === scenario.playwright?.automationId)) {
        const current = specsRef.current[scenario.id];
        if (useAgent || !current?.automationId || current.signature !== currentSignature) {
          specsRef.current = { ...specsRef.current, [scenario.id]: result };
          setSpecs?.(specsRef.current);
        } else {
          return current;
        }
      }
      return result;
    })().finally(() => {
      requests.current.delete(requestKey);
      if (mounted.current && useAgent) {
        setGenerating(previous => { const next = new Set(previous); next.delete(scenario.id); return next; });
      }
    });
    requests.current.set(requestKey, task);
    return task;
  }, [project.id, setSpecs]);

  const items = scenarios ?? [];
  const statusCounts = { all: items.length + qualityItems.length, quality: qualityItems.length, pending: 0, generating: 0, generated: 0, review: 0, error: 0 };
  const normalized = query.trim().toLocaleLowerCase('es');
  const rows = items.map(scenario => {
    const spec = specs[scenario.id];
    const status = codeStatus(scenario, spec, generating.has(scenario.id));
    const filename = spec && !spec.error ? spec.filename : scenario.playwright?.filename;
    const path = filename ? specPath({ scenarioId: scenario.id, filename }) : '';
    statusCounts[status]++;
    return { scenario, spec, status, path };
  });

  const qualityRows = qualityItems.flatMap(scenario => {
    const origin = scenario.quality;
    if (!origin) return [];
    const status: Exclude<AutomationFilter, 'all' | 'quality'> = generating.has(scenario.id) ? 'generating' : qualityErrors[scenario.id] ? 'error'
      : origin.automation.prepared ? 'generated' : origin.automation.reviewReason ? 'review' : 'pending';
    statusCounts[status]++;
    const path = origin.label + ' · ' + origin.automation.tool + ' · ' + origin.automation.filename;
    return [{ scenario, origin, status, path }];
  });
  const filtered = [...(listError ? [] : rows), ...qualityRows].filter(row =>
    (statusFilter === 'all' || statusFilter === row.status || (statusFilter === 'quality' && 'origin' in row))
    && (!tag || row.scenario.tags?.includes(tag))
    && matchesScenarioQuery(row.scenario, normalized, row.path));
  const onlyQuality = filtered.length > 0 && filtered.every(row => 'origin' in row);
  const { visible, results, resetPage, pagination } = useScenarioPagination(filtered);
  const selectedScenarios = listError ? [] : items.filter(scenario => selected.has(scenario.id));
  const selectedQualityRows = qualityRows.filter(({ scenario }) => qualitySelection === null || qualitySelection.has(scenario.id));
  const generationSelection = new Set([...selectedScenarios.map(item => item.id), ...selectedQualityRows.map(({ scenario }) => scenario.id)]);
  const prepared = rows.filter(({ status }) => status === 'generated').map(({ scenario }) => scenario);
  const ready = prepared.filter(scenario => selected.has(scenario.id));
  const canRun = project.status === 'READY' && environments.length > 0 && ready.length > 0 && !listError && !onlyQuality;
  const browserSuite = canRun ? ready : [];
  const runnableQualityCount = project.status === 'READY'
    ? selectedQualityRows.filter(({ scenario }) => !qualityExecutionProblem(scenario, project, role)).length : 0;
  const suiteCount = browserSuite.length + runnableQualityCount;
  const pendingQuality = selectedQualityRows.filter(({ origin }) => !origin.automation.prepared);
  const generationDisabled = busy || ((!!listError || ready.length === selectedScenarios.length) && pendingQuality.length === 0);

  function refreshList() {
    setRefresh(value => value + 1);
    void loadQuality();
  }

  function toggle(id: string) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function selectVisible(next: Set<string>) {
    setSelected(new Set(items.filter(item => next.has(item.id)).map(item => item.id)));
    setQualitySelection(new Set(qualityRows.filter(({ scenario }) => next.has(scenario.id)).map(({ scenario }) => scenario.id)));
  }

  function qualityFilePath(origin: QualityOrigin) {
    return `/api/projects/${project.id}/scenarios/quality/${origin.kind}/${origin.resourceId}/automation`;
  }

  async function prepareQuality(scenario: ScenarioListItem, origin: QualityOrigin): Promise<PreparationOutcome> {
    setGenerating(previous => new Set(previous).add(scenario.id));
    setQualityErrors(previous => ({ ...previous, [scenario.id]: '' }));
    try {
      const payload = await fetchQualityFile(qualityFilePath(origin), 'POST');
      const reviewReason = typeof payload.reviewReason === 'string' ? payload.reviewReason : undefined;
      const prepared = payload.prepared === true;
      if (!prepared && !reviewReason) throw new Error('La API no confirmó la generación del archivo.');
      updateQualityAutomation(scenario.id, { ...origin.automation, prepared, reviewReason });
      return prepared ? 'saved' : 'review';
    } catch (reason) {
      setQualityErrors(previous => ({ ...previous, [scenario.id]: reason instanceof Error ? reason.message : 'No se pudo preparar el archivo.' }));
      return 'error';
    } finally {
      setGenerating(previous => { const next = new Set(previous); next.delete(scenario.id); return next; });
    }
  }

  async function downloadQuality(origin: QualityOrigin) {
    try {
      const payload = await fetchQualityFile(qualityFilePath(origin), 'GET');
      if (typeof payload.code !== 'string' || !payload.code || payload.filename !== origin.automation.filename) {
        throw new Error('La API no devolvió un archivo de código válido.');
      }
      const link = document.createElement('a');
      const url = URL.createObjectURL(new Blob([payload.code], { type: 'text/javascript;charset=utf-8' }));
      link.href = url;
      link.download = payload.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo descargar el archivo.');
      void loadQuality();
    }
  }

  async function prepare() {
    if (generationDisabled) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const selectedKinds = new Set(pendingQuality.map(({ origin }) => origin.kind));
      const readyIds = new Set(ready.map(scenario => scenario.id));
      async function prepareBrowserScenarios(): Promise<PreparationOutcome[]> {
        const results: PreparationOutcome[] = [];
        for (const scenario of selectedScenarios) {
          if (!mounted.current) break;
          if (readyIds.has(scenario.id)) {
            results.push('saved');
            continue;
          }
          const spec = await generateOne(scenario, 'prepare');
          results.push(spec.error ? 'error' : spec.automationId ? 'saved' : 'review');
        }
        return results;
      }
      const groups = await Promise.all([
        prepareBrowserScenarios(),
        ...Array.from(selectedKinds, async kind => {
          const results: PreparationOutcome[] = [];
          for (const { scenario, origin } of pendingQuality.filter(item => item.origin.kind === kind)) {
            if (!mounted.current) break;
            results.push(await prepareQuality(scenario, origin));
          }
          return results;
        }),
      ]);
      if (!mounted.current) return;
      if (pendingQuality.length) await loadQuality();
      const results = groups.flat();
      const saved = selectedQualityRows.length - pendingQuality.length + results.filter(result => result === 'saved').length;
      const review = results.filter(result => result === 'review').length;
      if (results.includes('error')) setError('Algunos archivos no se pudieron generar. Revisa los errores por escenario.');
      if (saved || review) setNotice(`${saved} con código guardado${review ? ` · ${review} en revisión` : ''}.`);
    } catch { setError('No se pudo preparar el código. Vuelve a intentarlo.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <section className="automation-panel" aria-label={hasQuality ? 'Automatización de pruebas' : 'Automatización Playwright'}>
    {header?.element && createPortal(<ProjectHeading project={project}
      summary={hasQuality
        ? 'Genera código para los escenarios seleccionados y revisa la configuración antes de ejecutar.'
        : 'Genera y ejecuta el código de los escenarios seleccionados.'}
      actions={<>{canRunSuite && runner && <button type="button"
        disabled={runner.stopping || (!runner.hasSuite && (busy || suiteCount === 0))}
        onClick={() => runner.open(browserSuite, selectedQualityRows.map(({ scenario }) => scenario), {
          scenarios: project.status === 'READY' && environments.length > 0 && !listError ? prepared : [],
          qualityScenarios: qualityItems,
        })}>
        <ArrowRight size={14} />{runner.hasSuite ? 'Ver suite' : `Ejecutar suite (${suiteCount})`}
      </button>}</>} />, header.element)}
    {canGenerate && <GenerationCard title="Generar código de automatización" variant="playwright" disabled={generationDisabled} action={
      <button type="button" disabled={generationDisabled} onClick={() => void prepare()}>
        <Play size={13} aria-hidden="true" />{busy ? 'Generando…' : `Generar seleccionados (${generationSelection.size})`}
      </button>
    }>
      <p className="muted">{hasQuality
        ? 'Los agentes preparan el archivo de cada prueba seleccionada con su herramienta correspondiente.'
        : 'Selecciona los casos de Funcional web, Mobile emulado o Compatibilidad para generar su código.'}</p>
    </GenerationCard>}
    {notice && <p className="automation-message automation-operation-notice" role="status">{notice}</p>}
    {error && <p className="automation-message error" role="alert">{error}</p>}
    <ScenarioListToolbar
      label="Buscar y filtrar automatización" searchLabel={hasQuality ? 'Buscar pruebas para automatización' : 'Buscar escenarios para Playwright'}
      placeholder="Buscar por título, ID, paso o archivo…"
      query={query} onQueryChange={value => { setQuery(value); resetPage(); }}
      status={{ label: hasQuality ? 'Filtrar pruebas de automatización' : 'Filtrar por estado del código',
        value: statusFilter, onChange: value => { setStatusFilter(value); resetPage(); },
        options: (Object.keys(AUTOMATION_STATUS_LABELS) as AutomationFilter[])
          .filter(value => value !== 'quality' || hasQuality || statusFilter === 'quality')
          .map(value => ({
            value, label: AUTOMATION_STATUS_LABELS[value].replace('…', ''), count: statusCounts[value],
          })) }}
      items={[...items, ...qualityItems]} tag={tag} onTagChange={value => { setTag(value); resetPage(); }}
    />
    {header?.active && <AutomationRunStatus projectId={project.id} canStop={canRunSuite} />}
    {(project.status !== 'READY' || !environments.length) && <p className="automation-message">Para ejecutar necesitas un registro completo y un entorno autorizado.</p>}
    <section className="automation-scenarios" aria-labelledby="automation-scenarios-heading">
      <header>
        <h2 id="automation-scenarios-heading">{listTitle}</h2>
        <div className="automation-scenarios__tools">
          <span className="automation-suite-count">Suite {selected.size}/{scenarios?.length ?? '…'}</span>
          <button type="button" aria-label="Actualizar escenarios de automatización" disabled={busy} onClick={refreshList}><RefreshCw size={13} /></button>
        </div>
        <ScenarioVisibleSelection visible={visible.map(row => row.scenario)}
          selected={generationSelection} onSelectionChange={selectVisible} selectionDisabled={busy} />
      </header>
      {qualityError && <p className="automation-message" role="status">No se pudieron consultar las pruebas de calidad.{' '}
        <button type="button" className="secondary" onClick={() => void loadQuality()}>Reintentar consulta de calidad</button></p>}
      {listError && <div className="automation-list-message" role="alert"><p className="error">{listError}</p><button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Reintentar automatización</button></div>}
      {scenarios === null && !hasQuality ? (listError ? null : <p className="automation-list-message" role="status">Cargando escenarios…</p>)
        : !scenarios?.length && !hasQuality ? <div className="automation-list-message"><FileCode2 size={25} /><h3>Aún no hay escenarios para automatizar</h3><p>Crea escenarios y define sus pasos para preparar código.</p><Link href="#escenarios">Ir a Escenarios →</Link></div>
        : !visible.length ? <div className="automation-list-message"><h3>No hay coincidencias</h3>
          <button type="button" className="secondary" onClick={() => { setQuery(''); setTag(''); setStatusFilter('all'); resetPage(); }}>Limpiar filtros</button></div>
        : <ul ref={results} className="automation-pick-list" tabIndex={-1} aria-label={listTitle}>{visible.map(row => {
          const { scenario, path, status } = row;
          if ('origin' in row) {
            const { origin } = row;
            return <li key={scenario.id}>
              <input type="checkbox" checked={generationSelection.has(scenario.id)} disabled={busy}
                aria-label={`Automatizar ${scenario.title}`} onChange={event => {
                  const next = new Set(selectedQualityRows.map(({ scenario: item }) => item.id));
                  if (event.target.checked) next.add(scenario.id); else next.delete(scenario.id);
                  setQualitySelection(next);
                }} />
              <div>
                <div className="automation-pick-meta">
                  <code title={origin.resourceId}>{origin.resourceId.slice(0, 8)}</code>
                  {scenario.tags?.map(tag => <span key={tag}>{tag}</span>)}
                  <span className={`automation-generation-state${status === 'generated' ? ' is-generated' : status === 'error' ? ' is-error' : status === 'review' ? ' is-review' : ''}`}>{AUTOMATION_STATUS_LABELS[status]}</span>
                </div>
                <h3>{scenario.title}</h3>
                <p className="automation-quality-detail">{origin.label} · {origin.automation.tool}</p>
                {origin.kind === 'ux' && <p className="automation-quality-detail">El archivo reúne comprobaciones de accesibilidad y evidencias para el análisis UX de AutoQA.</p>}
                {status === 'review' && <p className="automation-review-reasons">{origin.automation.reviewReason}</p>}
                {qualityErrors[scenario.id] && <p className="error" role="alert">{qualityErrors[scenario.id]}</p>}
                {origin.automation.prepared && <button type="button" className="secondary automation-row-retry"
                  onClick={() => void downloadQuality(origin)}>Descargar {origin.automation.filename}</button>}
                {origin.href && <Link className="automation-quality-link" href={origin.href}>Ver configuración →</Link>}
                {origin.hasResult && <p className="automation-quality-detail"><QualityResultsLink projectId={project.id} /></p>}
              </div>
            </li>;
          }
          const { spec } = row;
          return <li key={scenario.id}>
            <input type="checkbox" checked={selected.has(scenario.id)} disabled={busy} aria-label={`Automatizar ${scenario.title}`} onChange={() => toggle(scenario.id)} />
            <div><div className="automation-pick-meta"><code title={scenario.id}>{scenario.id.slice(0, 8)}</code>{visibleScenarioTags(scenario.tags).map(tag => <span key={tag}>{tag}</span>)}
              <span className={`automation-generation-state${status === 'error' ? ' is-error' : status === 'review' ? ' is-review' : status === 'generated' ? ' is-generated' : ''}`}>{AUTOMATION_STATUS_LABELS[status]}</span></div>
              <h3>{scenario.title}</h3>
              <p className="automation-pick-path" title={path || undefined}>{path || (status === 'error' ? 'Código no disponible' : 'Código pendiente de generación')}</p>
              {spec?.error && <>
                <p className="error" role="alert">{spec.error}</p>
                <button type="button" className="secondary automation-row-retry" disabled={busy || status === 'generating'}
                  onClick={() => void generateOne(scenario, canGenerate ? 'prepare' : 'preview')}>Reintentar archivo</button>
              </>}
              {spec?.notice && <p className="automation-review-reasons">{spec.notice}</p>}
              {spec?.review.length ? <p className="automation-review-reasons">{spec.review.join(' · ')}</p> : null}
            </div>
          </li>;
        })}</ul>}
      {(scenarios || hasQuality) && <ScenarioPagination label="Paginación de automatización" {...pagination} />}
    </section>
  </section>;
}

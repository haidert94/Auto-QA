'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowRight, Download, FileCode2, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { scenarioRunEnvironmentError, type Project } from '../onboarding';
import type { ScenarioListItem } from './scenario-card';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { GenerationCard } from './generation-card';
import { ProjectHeading } from './project-heading';
import { useAutomationHeader, useScenarioSuite } from './project-tabs';
import { AutomationCodeViewer } from './automation-code-viewer';
import { downloadSpecs, scenarioSpecSignature, specFilename, specPath, type GeneratedSpec } from './automation-export';
import { isManualScenario, matchesScenarioQuery } from './scenario-presentation';
import { ScenarioListToolbar } from './scenario-list-toolbar';
import { ScenarioPagination, useScenarioPagination } from './scenario-pagination';

const AUTOMATION_STATUS_LABELS = {
  all: 'Todos',
  pending: 'Pendiente',
  generating: 'Generando…',
  generated: 'Generado',
  review: 'Requiere revisión',
  error: 'Error',
} as const;

type AutomationFilter = keyof typeof AUTOMATION_STATUS_LABELS;

function codeStatus(scenario: ScenarioListItem, spec: GeneratedSpec | undefined, generating: boolean): Exclude<AutomationFilter, 'all'> {
  if (generating) return 'generating';
  if (spec?.automationId || scenario.playwright) return 'generated';
  if (spec?.error) return 'error';
  return spec?.review.length ? 'review' : 'pending';
}

function reviewCode(scenario: ScenarioListItem, code: string) {
  const reasons = [];
  if (!scenario.steps?.length) reasons.push('Sin pasos definidos');
  if (/^\s*\/\/ TODO\b/m.test(code)) reasons.push('Contiene pasos por completar');
  const executable = code.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  if (!/\bexpect\s*\(/.test(executable)) reasons.push('No se detectan aserciones activas');
  return reasons;
}

export function AutomationPanel({ project, role }: { project: Project; role?: OrgRole }) {
  const canGenerate = can(role, 'automation.generate');
  const canRunSuite = can(role, 'run.execute');
  const header = useAutomationHeader();
  const runner = useScenarioSuite();
  const specs = header?.specs ?? {};
  const setSpecs = header?.setSpecs;
  const [scenarios, setScenarios] = useState<ScenarioListItem[] | null>(null);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
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
        setActiveId(previous => previous === 'configuration' || list.some(item => item.id === previous) ? previous : list[0]?.id ?? null);
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setListError(reason instanceof Error ? reason.message : 'No se pudo consultar la automatización.'); });
    return () => controller.abort();
  }, [project.id, header?.active, refresh, setSpecs]);

  const generateOne = useCallback((scenario: ScenarioListItem, mode: 'preview' | 'prepare' | 'download' = 'preview'): Promise<GeneratedSpec> => {
    const currentSignature = scenarioSpecSignature(scenario);
    const cached = specsRef.current[scenario.id];
    const useAgent = mode === 'prepare';
    if (cached?.signature === currentSignature && (mode === 'preview' || (!cached.error && (!useAgent || cached.automationId)))) {
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
        const review = reviewCode(scenario, payload.code);
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

  useEffect(() => {
    if (!header?.active || !scenarios || !activeId || activeId === 'configuration') return;
    const scenario = scenarios.find(item => item.id === activeId);
    if (scenario) void generateOne(scenario);
  }, [header?.active, scenarios, activeId, generateOne]);

  const items = scenarios ?? [];
  const statusCounts = { all: items.length, pending: 0, generating: 0, generated: 0, review: 0, error: 0 };
  const normalized = query.trim().toLocaleLowerCase('es');
  const rows = items.map(scenario => {
    const spec = specs[scenario.id];
    const status = codeStatus(scenario, spec, generating.has(scenario.id));
    const filename = spec && !spec.error ? spec.filename : scenario.playwright?.filename;
    const path = filename ? specPath({ scenarioId: scenario.id, filename }) : '';
    statusCounts[status]++;
    return { scenario, spec, status, path };
  });
  const filtered = rows.filter(({ scenario, path, status }) => !listError
    && (statusFilter === 'all' || statusFilter === status)
    && (!tag || scenario.tags?.includes(tag))
    && matchesScenarioQuery(scenario, normalized, path));
  const { visible, results, resetPage, pagination } = useScenarioPagination(filtered);
  const selectedScenarios = items.filter(scenario => selected.has(scenario.id));
  const generated = (scenarios ?? []).map(scenario => specs[scenario.id]).filter((spec): spec is GeneratedSpec => !!spec);
  const ready = rows.filter(({ scenario, status }) => selected.has(scenario.id) && status === 'generated').map(({ scenario }) => scenario);
  const canRun = project.status === 'READY' && environments.length > 0 && ready.length > 0 && !listError;

  function toggle(id: string) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function prepare(download = false) {
    if (busy || !selectedScenarios.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const results = [];
      for (const scenario of selectedScenarios) { if (!mounted.current) return; results.push(await generateOne(scenario, download ? 'download' : 'prepare')); }
      if (results.some(spec => spec.error)) {
        setError('Algunos archivos no se pudieron generar. Revisa los errores por escenario; no se descargó un ZIP incompleto.'); return;
      }
      if (download) {
        await downloadSpecs(project.name, results);
        setNotice(`ZIP preparado con ${results.length} archivos .spec.ts, configuración y notas de revisión.`);
      } else {
        const saved = results.filter(spec => spec.automationId).length;
        const review = results.length - saved;
        setNotice(`${saved} con código guardado${review ? ` · ${review} en revisión` : ''}.`);
      }
    } catch { setError('No se pudo preparar el código. Vuelve a intentarlo.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  const selectedSpec = activeId ? specs[activeId] : undefined;
  const generationDisabled = busy || !selectedScenarios.length || !!listError;
  return <section className="automation-panel" aria-label="Automatización Playwright">
    {header?.element && createPortal(<ProjectHeading project={project}
      summary="Generador de código Playwright TypeScript a partir de los escenarios guardados. Revisa el código antes de solicitar su ejecución."
      actions={<><button type="button" className="secondary" disabled={busy || !selected.size || !!listError} onClick={() => void prepare(true)}><Download size={14} />{busy ? 'Preparando…' : 'Descargar .spec.ts (.zip)'}</button>
        {canRunSuite && runner && <button type="button" disabled={!runner.hasSuite && (busy || !canRun)} onClick={() => runner.open(ready)}><ArrowRight size={14} />{runner.hasSuite ? 'Ver suite' : `Ejecutar en runners (${ready.length})`}</button>}</>} />, header.element)}
    {canGenerate && <GenerationCard title="Generar código Playwright" variant="playwright" disabled={generationDisabled} action={
      <button type="button" disabled={generationDisabled} onClick={() => void prepare()}>
        <Play size={13} aria-hidden="true" />{busy ? 'Generando…' : `Generar seleccionados (${selected.size})`}
      </button>
    }>
      <p className="muted">El agente convierte los escenarios seleccionados en código Playwright. Revisa el código antes de ejecutarlo.</p>
    </GenerationCard>}
    {notice && <p className="automation-message automation-operation-notice" role="status">{notice}</p>}
    {error && <p className="automation-message error" role="alert">{error}</p>}
    <ScenarioListToolbar
      label="Buscar y filtrar automatización" searchLabel="Buscar escenarios para Playwright" placeholder="Buscar por título, ID, paso o archivo…"
      query={query} onQueryChange={value => { setQuery(value); resetPage(); }}
      status={{ label: 'Filtrar por estado del código', value: statusFilter, onChange: value => { setStatusFilter(value); resetPage(); },
        options: (Object.keys(AUTOMATION_STATUS_LABELS) as AutomationFilter[]).map(value => ({
          value, label: AUTOMATION_STATUS_LABELS[value].replace('…', ''), count: statusCounts[value],
        })) }}
      items={items} tag={tag} onTagChange={value => { setTag(value); resetPage(); }} visible={visible.map(row => row.scenario)}
      selected={selected} onSelectionChange={setSelected} selectionDisabled={busy}
    />
    <div className="automation-workspace">
      <section className="automation-scenarios" aria-labelledby="automation-scenarios-heading">
        <header><div><h2 id="automation-scenarios-heading">Escenarios para Playwright</h2>
          <p>{selected.size} seleccionados · {ready.length} con código guardado</p></div>
          <div className="automation-scenarios__tools">
            <span className="automation-suite-count">Suite {selected.size}/{scenarios?.length ?? '…'}</span>
            <button type="button" aria-label="Actualizar escenarios de automatización" disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13} /></button>
          </div>
        </header>
        {listError ? <div className="automation-list-message" role="alert"><p className="error">{listError}</p><button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Reintentar automatización</button></div>
          : scenarios === null ? <p className="automation-list-message" role="status">Cargando escenarios…</p>
          : !scenarios.length ? <div className="automation-list-message"><FileCode2 size={25} /><h3>Aún no hay escenarios para automatizar</h3><p>Crea escenarios y define sus pasos para preparar código.</p><Link href="#escenarios">Ir a Escenarios →</Link></div>
          : !visible.length ? <div className="automation-list-message"><h3>No hay coincidencias</h3>
            <button type="button" className="secondary" onClick={() => { setQuery(''); setTag(''); setStatusFilter('all'); resetPage(); }}>Limpiar filtros</button></div>
          : <ul ref={results} className="automation-pick-list" tabIndex={-1} aria-label="Escenarios para Playwright">{visible.map(({ scenario, spec, status, path }) => {
            return <li key={scenario.id} className={activeId === scenario.id ? 'automation-pick--active' : ''}>
              <input type="checkbox" checked={selected.has(scenario.id)} disabled={busy} aria-label={`Automatizar ${scenario.title}`} onChange={() => toggle(scenario.id)} />
              <div><div className="automation-pick-meta"><code title={scenario.id}>{scenario.id.slice(0, 8)}</code>{scenario.tags?.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}
                <span className={`automation-generation-state${status === 'error' ? ' is-error' : status === 'review' ? ' is-review' : status === 'generated' ? ' is-generated' : ''}`}>{AUTOMATION_STATUS_LABELS[status]}</span></div>
                <h3><button type="button" aria-pressed={activeId === scenario.id} onClick={() => setActiveId(scenario.id)}>{scenario.title}</button></h3>
                <p className="automation-pick-path" title={path || undefined}>{path || (status === 'error' ? 'Código no disponible' : 'Código pendiente de generación')}</p>
                {spec?.error && <p className="error" role="alert">{spec.error}</p>}
                {spec?.notice && <p className="automation-review-reasons">{spec.notice}</p>}
                {spec?.review.length ? <p className="automation-review-reasons">{spec.review.join(' · ')}</p> : null}
              </div>
            </li>;
          })}</ul>}
        {scenarios && !listError && <ScenarioPagination label="Paginación de automatización" {...pagination} />}
      </section>
      <div className="automation-preview-column"><AutomationCodeViewer specs={generated} activeId={activeId} onSelect={setActiveId} loading={generating.size > 0 || (!!activeId && activeId !== 'configuration' && !selectedSpec && !listError)} />
        {selectedSpec?.error && <div className="automation-preview-note"><p className="error">{selectedSpec.error}</p><button type="button" className="secondary" disabled={busy} onClick={() => { const scenario = scenarios?.find(item => item.id === activeId); if (scenario) void generateOne(scenario, canGenerate ? 'prepare' : 'download'); }}>Reintentar archivo</button></div>}
        {selectedSpec?.review.length ? <p className="automation-preview-note">Pendientes detectados: {selectedSpec.review.join(' · ')}. Se incluye el código en la descarga para su revisión, pero no en la solicitud de ejecución.</p> : null}
        {(project.status !== 'READY' || !environments.length) && <p className="automation-preview-note">Para ejecutar necesitas un registro completo y un entorno autorizado.</p>}
      </div>
    </div>
  </section>;
}

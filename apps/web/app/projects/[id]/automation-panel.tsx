'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowRight, Download, FileCode2, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../onboarding';
import type { ScenarioListItem } from './scenario-card';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { ProjectHeading } from './project-heading';
import { useAutomationHeader } from './project-tabs';
import { AutomationCodeViewer } from './automation-code-viewer';
import { downloadSpecs, scenarioSpecSignature, specFilename, specPath, type GeneratedSpec } from './automation-export';
import { ScenarioRunDialog } from './scenario-run-dialog';

function reviewCode(scenario: ScenarioListItem, code: string) {
  const reasons = [];
  if (!scenario.steps?.length) reasons.push('Sin pasos definidos');
  if (/\bTODO\b/.test(code)) reasons.push('Contiene pasos por completar');
  const executable = code.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  if (!/\bexpect\s*\(/.test(executable)) reasons.push('No se detectan aserciones activas');
  return reasons;
}

export function AutomationPanel({ project, role }: { project: Project; role?: OrgRole }) {
  const canGenerate = can(role, 'automation.generate');
  const canRunSuite = can(role, 'run.execute');
  const header = useAutomationHeader();
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
  const [runSelection, setRunSelection] = useState<ScenarioListItem[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const listRef = useRef<ScenarioListItem[]>([]);
  const specsRef = useRef<Record<string, GeneratedSpec>>({});
  const requests = useRef(new Map<string, Promise<GeneratedSpec>>());
  const mounted = useRef(true);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const environments = project.environments.filter(environment => environment.authorizationConfirmed && environment.readOnly);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!header?.active) return;
    const controller = new AbortController();
    setListError('');
    fetch(`/api/projects/${project.id}/scenarios`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('No se pudo cargar la lista de automatización.');
        const list: ScenarioListItem[] = await response.json();
        if (controller.signal.aborted) return;
        const firstLoad = listRef.current.length === 0;
        listRef.current = list;
        const current = Object.fromEntries(Object.entries(specsRef.current).filter(([id, spec]) => list.some(item => item.id === id && scenarioSpecSignature(item) === spec.signature)));
        specsRef.current = current; setSpecs?.(current);
        setSelected(previous => new Set(list.filter(item => firstLoad || previous.has(item.id)).map(item => item.id)));
        setScenarios(list);
        setActiveId(previous => previous === 'configuration' || list.some(item => item.id === previous) ? previous : list[0]?.id ?? null);
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setListError(reason instanceof Error ? reason.message : 'No se pudo consultar la automatización.'); });
    return () => controller.abort();
  }, [project.id, header?.active, refresh, setSpecs]);

  const generateOne = useCallback((scenario: ScenarioListItem, retry = false): Promise<GeneratedSpec> => {
    const currentSignature = scenarioSpecSignature(scenario);
    const cached = specsRef.current[scenario.id];
    if (cached?.signature === currentSignature && !(retry && cached.error)) return Promise.resolve(cached);
    const pending = requests.current.get(scenario.id);
    if (pending) return pending;
    setGenerating(previous => new Set(previous).add(scenario.id));
    const task = (async () => {
      let result: GeneratedSpec = { scenarioId: scenario.id, title: scenario.title, filename: '', code: '', signature: currentSignature, review: [] };
      try {
        const response = await fetch(`/api/projects/${project.id}/scenarios/${scenario.id}/playwright`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message ?? 'No se pudo generar este archivo.');
        if (typeof payload.code !== 'string' || !payload.code.trim() || typeof payload.filename !== 'string') throw new Error('La API no devolvió un archivo de código válido.');
        result = { ...result, code: payload.code, filename: specFilename(payload.filename, scenario.id), review: reviewCode(scenario, payload.code) };
      } catch (reason) { result.error = reason instanceof Error ? reason.message : 'No se pudo generar este archivo.'; }
      if (mounted.current && listRef.current.some(item => item.id === scenario.id && scenarioSpecSignature(item) === currentSignature)) {
        specsRef.current = { ...specsRef.current, [scenario.id]: result }; setSpecs?.(specsRef.current);
      }
      return result;
    })().finally(() => {
      requests.current.delete(scenario.id);
      if (mounted.current) setGenerating(previous => { const next = new Set(previous); next.delete(scenario.id); return next; });
    });
    requests.current.set(scenario.id, task);
    return task;
  }, [project.id, setSpecs]);

  useEffect(() => {
    if (!header?.active || !scenarios || !activeId || activeId === 'configuration') return;
    const scenario = scenarios.find(item => item.id === activeId);
    if (scenario) void generateOne(scenario);
  }, [header?.active, scenarios, activeId, generateOne]);

  const selectedScenarios = (scenarios ?? []).filter(scenario => selected.has(scenario.id));
  const generated = (scenarios ?? []).map(scenario => specs[scenario.id]).filter((spec): spec is GeneratedSpec => !!spec);
  const ready = selectedScenarios.filter(scenario => specs[scenario.id] && !specs[scenario.id].error && !specs[scenario.id].review.length);
  const canRun = project.status === 'READY' && environments.length > 0 && ready.length > 0 && !listError;
  const allSelected = !!scenarios?.length && selected.size === scenarios.length;
  useEffect(() => { if (allCheckbox.current) allCheckbox.current.indeterminate = selected.size > 0 && !allSelected; }, [selected, allSelected]);

  function toggle(id: string) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function prepare(download = false) {
    if (busy || !selectedScenarios.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const results = [];
      for (const scenario of selectedScenarios) { if (!mounted.current) return; results.push(await generateOne(scenario, true)); }
      if (results.some(spec => spec.error)) {
        setError('Algunos archivos no se pudieron generar. Revisa los errores por escenario; no se descargó un ZIP incompleto.'); return;
      }
      if (download) await downloadSpecs(project.name, results);
      setNotice(download ? `ZIP preparado con ${results.length} archivos .spec.ts, configuración y notas de revisión.` : `${results.length} archivos generados. Revisa los pendientes antes de ejecutar.`);
    } catch { setError('No se pudo preparar la descarga. Vuelve a intentarlo.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  const selectedSpec = activeId ? specs[activeId] : undefined;
  return <section className="automation-panel" aria-label="Automatización Playwright">
    {header?.element && createPortal(<ProjectHeading project={project}
      summary="Generador de código Playwright TypeScript a partir de los escenarios guardados. Revisa el código antes de solicitar su ejecución."
      actions={<><button type="button" className="secondary" disabled={busy || !selected.size || !!listError} onClick={() => void prepare(true)}><Download size={14} />{busy ? 'Preparando…' : 'Descargar .spec.ts (.zip)'}</button>
        {canRunSuite && <button type="button" disabled={busy || !canRun} onClick={() => setRunSelection(ready)}><ArrowRight size={14} />Ejecutar en runners ({ready.length})</button>}</>} />, header.element)}
    {error && <p className="automation-message error" role="alert">{error}</p>}
    <div className="automation-workspace">
      <section className="automation-scenarios" aria-labelledby="automation-scenarios-heading">
        <header><div><h2 id="automation-scenarios-heading">Escenarios para Playwright</h2>
          <p>{selected.size} seleccionados · {ready.length} sin pendientes detectados</p></div><span className="automation-suite-count">Suite {selected.size}/{scenarios?.length ?? '…'}</span></header>
        <div className="automation-bulk-select"><label><input ref={allCheckbox} type="checkbox" checked={allSelected} disabled={busy || !scenarios?.length || !!listError}
          onChange={() => setSelected(allSelected ? new Set() : new Set(scenarios?.map(scenario => scenario.id) ?? []))} />Seleccionar todos</label>
          <button type="button" aria-label="Actualizar escenarios de automatización" disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13} /></button></div>
        {listError ? <div className="automation-list-message" role="alert"><p className="error">{listError}</p><button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Reintentar automatización</button></div>
          : scenarios === null ? <p className="automation-list-message" role="status">Cargando escenarios…</p>
          : !scenarios.length ? <div className="automation-list-message"><FileCode2 size={25} /><h3>Aún no hay escenarios para automatizar</h3><p>Crea escenarios y define sus pasos para preparar código.</p><Link href="#escenarios">Ir a Escenarios →</Link></div>
          : <ul className="automation-pick-list">{scenarios.map(scenario => {
            const spec = specs[scenario.id];
            const status = generating.has(scenario.id) ? 'Generando…' : spec?.error ? 'Error' : spec ? spec.review.length ? 'Requiere revisión' : 'Generado' : 'Pendiente';
            return <li key={scenario.id} className={activeId === scenario.id ? 'automation-pick--active' : ''}>
              <input type="checkbox" checked={selected.has(scenario.id)} disabled={busy} aria-label={`Automatizar ${scenario.title}`} onChange={() => toggle(scenario.id)} />
              <div><div className="automation-pick-meta"><code title={scenario.id}>{scenario.id.slice(0, 8)}</code>{scenario.tags?.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}
                <span className={`automation-generation-state${spec?.error ? ' is-error' : spec?.review.length ? ' is-review' : spec ? ' is-generated' : ''}`}>{status}</span></div>
                <h3><button type="button" aria-pressed={activeId === scenario.id} onClick={() => setActiveId(scenario.id)}>{scenario.title}</button></h3>
                <p className="automation-pick-path" title={spec && !spec.error ? specPath(spec) : undefined}>{spec && !spec.error ? specPath(spec) : 'Código pendiente de generación'}</p>
                {spec?.error && <p className="error" role="alert">{spec.error}</p>}
                {spec?.review.length ? <p className="automation-review-reasons">{spec.review.join(' · ')}</p> : null}
              </div>
            </li>;
          })}</ul>}
        <footer className="automation-scenarios__footer">{canGenerate && <button type="button" disabled={busy || !selected.size || !!listError} onClick={() => void prepare()}><Play size={13} />{busy ? 'Generando…' : `Generar seleccionados (${selected.size})`}</button>}
          {notice && <p className="automation-operation-notice" role="status">{notice}</p>}
          <p>Generación determinística. «Generado» no implica compilación ni ejecución aprobada.</p></footer>
      </section>
      <div className="automation-preview-column"><AutomationCodeViewer specs={generated} activeId={activeId} onSelect={setActiveId} generating={generating.size > 0} />
        {selectedSpec?.error && <div className="automation-preview-note"><p className="error">{selectedSpec.error}</p><button type="button" className="secondary" disabled={busy} onClick={() => { const scenario = scenarios?.find(item => item.id === activeId); if (scenario) void generateOne(scenario, true); }}>Reintentar archivo</button></div>}
        {selectedSpec?.review.length ? <p className="automation-preview-note">Pendientes detectados: {selectedSpec.review.join(' · ')}. Se incluye el código en la descarga para su revisión, pero no en la solicitud de ejecución.</p> : null}
        {(project.status !== 'READY' || !environments.length) && <p className="automation-preview-note">Para ejecutar necesitas un registro completo y un entorno autorizado de solo lectura.</p>}
      </div>
    </div>
    {runSelection && <ScenarioRunDialog projectId={project.id} scenarios={runSelection} environments={environments} onClose={() => setRunSelection(null)}
      onQueued={() => setNotice('Consulta las respuestas de encolado y el reporte para conocer el estado real de las ejecuciones.')} />}
  </section>;
}

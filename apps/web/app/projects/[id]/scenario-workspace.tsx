'use client';

import { Code2, FileText, Pencil, PlayCircle, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ScenarioCard, type ScenarioListItem } from './scenario-card';
import { ScenarioListToolbar, ScenarioVisibleSelection } from './scenario-list-toolbar';
import { ScenarioPagination, useScenarioPagination } from './scenario-pagination';
import { durationLabel, gherkinKeyword, isManualScenario, MANUAL_SCENARIO_MESSAGE, matchesScenarioQuery, runPresentation, scenarioStepText, type ScenarioRun } from './scenario-presentation';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';

export function ScenarioWorkspace({ items, runs, runsAvailable, checked, setChecked, onChange, projectId, hasRunnableSpec, onRun, role }: {
  items: ScenarioListItem[]; runs: ScenarioRun[]; runsAvailable: boolean; checked: Set<string>;
  setChecked: (selection: Set<string>) => void; onChange: (scenario: ScenarioListItem) => void;
  projectId: string; hasRunnableSpec: (scenario: ScenarioListItem) => boolean;
  onRun?: (scenarios: ScenarioListItem[]) => void; role?: OrgRole;
}) {
  const canEdit = can(role, 'scenario.update');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [mode, setMode] = useState<'all' | 'results' | 'pending'>('all');
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const normalized = query.trim().toLocaleLowerCase('es');
  const withResults = items.filter(item => (item._count?.results ?? 0) > 0).length;
  const filtered = items.filter(item => (!tag || item.tags?.includes(tag))
    && (mode === 'all' || (mode === 'results' ? (item._count?.results ?? 0) > 0 : !(item._count?.results ?? 0)))
    && matchesScenarioQuery(item, normalized));
  const { visible, results, resetPage, pagination } = useScenarioPagination(filtered);
  const firstVisibleId = visible[0]?.id ?? null;
  const active = items.find(item => item.id === activeId) ?? null;
  const activeOnPage = visible.some(item => item.id === activeId);
  const latest = new Map<string, ScenarioRun>();
  for (const run of [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    if (run.scenarioId && !latest.has(run.scenarioId)) latest.set(run.scenarioId, run);
  }

  useEffect(() => {
    if (activeId && !activeOnPage) {
      setActiveId(firstVisibleId);
      setEditing(false);
    }
  }, [activeId, activeOnPage, firstVisibleId]);

  function toggle(id: string) { const next = new Set(checked); if (next.has(id)) next.delete(id); else next.add(id); setChecked(next); }
  function pick(id: string) { setActiveId(id); setEditing(false); }

  return <>
    <ScenarioListToolbar
      label="Buscar y filtrar escenarios" searchLabel="Buscar escenarios" placeholder="Buscar por título, ID o paso…"
      query={query} onQueryChange={value => { setQuery(value); resetPage(); }}
      status={{ label: 'Filtrar por resultados', value: mode, onChange: value => { setMode(value); resetPage(); }, options: [
        { value: 'all', label: 'Todos', count: items.length },
        { value: 'results', label: 'Con resultados', count: withResults },
        { value: 'pending', label: 'Sin resultados', count: items.length - withResults },
      ] }}
      items={items} tag={tag} onTagChange={value => { setTag(value); resetPage(); }}
    />
    <ScenarioVisibleSelection visible={visible} selected={checked} onSelectionChange={setChecked} />
    <div className={`scenario-workspace${active ? '' : ' scenario-workspace--list-only'}`}>
      <div className="scenario-list-region">
        <ul ref={results} className="scenario-results" tabIndex={-1} aria-label="Escenarios del proyecto">
          {visible.map(item => {
            const run = latest.get(item.id);
            const status = runPresentation(run, runsAvailable);
            return <li key={item.id} className={`scenario-result${item.id === activeId ? ' scenario-result--active' : ''}`}>
              <input type="checkbox" aria-label={`Seleccionar ${item.title}`} checked={checked.has(item.id)} onChange={() => toggle(item.id)} />
              <div className="scenario-result__content">
                <div className="scenario-result__meta"><span className="scenario-short-id" title={item.id}>{item.id.slice(0, 8)}</span>
                  {item.id === activeId && <span className="scenario-focused-label">En detalle</span>}
                  <span className={`scenario-run-state scenario-run-state--${status.tone}`}>{status.label}{status.duration !== null && ` · ${durationLabel(status.duration)}`}</span>
                </div>
                <h3><button type="button" aria-pressed={item.id === activeId} onClick={() => pick(item.id)}>{item.title}</button></h3>
                <p className="scenario-source">{item.requirement ? <>Requisito: {item.requirement.externalKey && `${item.requirement.externalKey} / `}{item.requirement.title}</> : 'Sin requisito asociado'}</p>
                {item.tags?.length ? <ul className="scenario-result__tags" aria-label="Etiquetas">{item.tags.map(value => <li key={value} className={/^@flujo/i.test(value) ? 'flow' : ''}>{value}</li>)}</ul> : null}
                {run && <time dateTime={run.createdAt}>Última ejecución registrada: {new Date(run.createdAt).toLocaleString('es-CO')}</time>}
              </div>
            </li>;
          })}
        </ul>
        {!filtered.length && <div className="scenario-no-results"><Search size={24} /><h3>{items.length ? 'No hay coincidencias' : 'Aún no hay escenarios'}</h3>
          <p>{items.length ? 'Prueba otra búsqueda o ajusta los filtros.' : 'Crea un escenario manual o utiliza el generador existente.'}</p>
          {items.length > 0 && <button type="button" className="secondary" onClick={() => { setQuery(''); setTag(''); setMode('all'); resetPage(); }}>Limpiar filtros</button>}
        </div>}
        <ScenarioPagination label="Paginación de escenarios" {...pagination} />
      </div>
      {active && <aside className="scenario-detail" aria-label="Detalle del escenario seleccionado">
        <header className="scenario-detail__head"><div><span>{active.id.slice(0, 8)}</span><h2>Detalle del escenario</h2></div>
          <div className="scenario-detail__controls">
            {onRun && <button type="button" aria-label="Ejecutar escenario seleccionado" disabled={!hasRunnableSpec(active)} title={isManualScenario(active) ? MANUAL_SCENARIO_MESSAGE : undefined} onClick={() => onRun([active])}><PlayCircle size={16} /></button>}
            <button type="button" aria-label="Cerrar detalle del escenario" onClick={() => { setActiveId(null); setEditing(false); }}><X size={16} /></button>
          </div>
        </header>
        <div className="scenario-detail__body">
          {editing ? <ul className="scenario-editor-list"><ScenarioCard key={active.id} projectId={projectId} scenario={active} initialEditing
            onChange={onChange} onEditComplete={() => setEditing(false)} role={role} /></ul> : <>
            <h3>{active.title}</h3>
            {isManualScenario(active) && <p className="scenario-derived-note">{MANUAL_SCENARIO_MESSAGE}</p>}
            <p className="scenario-detail__source"><FileText size={14} />{active.requirement ? `${active.requirement.externalKey ? active.requirement.externalKey + ' / ' : ''}${active.requirement.title}` : 'Sin requisito asociado'}</p>
            <div className="scenario-detail__section-label"><span>Especificación BDD (vista derivada)</span><Code2 size={14} /></div>
            <div className="scenario-gherkin"><ol>{(active.steps ?? []).map((step, i) => <li key={i}>
              <span className="scenario-gherkin__keyword">{gherkinKeyword(step, active.steps?.[i - 1])}</span>
              <div>{scenarioStepText(step)}{step.expected && <p><span>Esperado:</span> {step.expected}</p>}</div>
            </li>)}</ol>{!active.steps?.length && <p>No hay pasos registrados.</p>}</div>
            <p className="scenario-derived-note">Palabras clave inferidas de las acciones. Revisa esta vista antes de utilizarla como especificación.</p>
            <section className="scenario-expected"><h4>Resultado esperado registrado</h4><p>{active.expectedResult ?? 'No declarado. Pendiente de definir.'}</p></section>
            {canEdit && <div className="scenario-detail__actions">
              <button type="button" className="secondary" onClick={() => setEditing(true)}><Pencil size={13} />Editar escenario</button>
            </div>}
          </>}
        </div>
      </aside>}
    </div>
  </>;
}

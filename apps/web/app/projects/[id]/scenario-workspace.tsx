'use client';

import Link from 'next/link';
import { Code2, ExternalLink, FileText, Pencil, PlayCircle, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { gherkinKeyword, ScenarioCard, type ScenarioListItem } from './scenario-card';
import { durationLabel, runPresentation, type ScenarioRun } from './scenario-presentation';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';

export function ScenarioWorkspace({ items, runs, runsAvailable, checked, setChecked, onChange, projectId, onRun, role }: {
  items: ScenarioListItem[]; runs: ScenarioRun[]; runsAvailable: boolean; checked: Set<string>;
  setChecked: (selection: Set<string>) => void; onChange: (scenario: ScenarioListItem) => void;
  projectId: string; onRun?: (scenarios: ScenarioListItem[]) => void; role?: OrgRole;
}) {
  const canEdit = can(role, 'scenario.update');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [mode, setMode] = useState<'all' | 'results' | 'pending'>('all');
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLocaleLowerCase('es');
  const tags = [...new Set(items.flatMap(item => item.tags ?? []))].sort();
  const withResults = items.filter(item => (item._count?.results ?? 0) > 0).length;
  const filtered = items.filter(item => (!tag || item.tags?.includes(tag))
    && (mode === 'all' || (mode === 'results' ? (item._count?.results ?? 0) > 0 : !(item._count?.results ?? 0)))
    && (!normalized || [item.title, item.id, item.expectedResult ?? '', item.requirement?.title ?? '', item.requirement?.externalKey ?? '',
      ...(item.steps ?? []).map(step => `${step.action} ${step.data ?? ''} ${step.expected ?? ''}`), ...(item.tags ?? [])]
      .join(' ').toLocaleLowerCase('es').includes(normalized)));
  const active = items.find(item => item.id === activeId) ?? null;
  const allChecked = filtered.length > 0 && filtered.every(item => checked.has(item.id));
  const latest = new Map<string, ScenarioRun>();
  for (const run of [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    if (run.scenarioId && !latest.has(run.scenarioId)) latest.set(run.scenarioId, run);
  }

  useEffect(() => {
    if (activeId && !items.some(item => item.id === activeId)) { setActiveId(null); setEditing(false); }
  }, [items, activeId]);
  useEffect(() => {
    if (activeId && !filtered.some(item => item.id === activeId)) { setActiveId(filtered[0]?.id ?? null); setEditing(false); }
  }, [activeId, filtered.map(item => item.id).join(',')]);
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = !allChecked && filtered.some(item => checked.has(item.id));
  }, [checked, filtered, allChecked]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || (!event.ctrlKey && !event.metaKey) || !search.current?.getClientRects().length) return;
      event.preventDefault(); search.current.focus();
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  function toggle(id: string) { const next = new Set(checked); if (next.has(id)) next.delete(id); else next.add(id); setChecked(next); }
  function pick(id: string) { setActiveId(id); setEditing(false); }
  function toggleVisible() {
    const next = new Set(checked);
    for (const item of filtered) { if (allChecked) next.delete(item.id); else next.add(item.id); }
    setChecked(next);
  }

  return <>
    <section className="scenario-toolbar" aria-label="Buscar y filtrar escenarios">
      <div className="scenario-toolbar__top">
        <label className="scenario-search"><Search size={15} aria-hidden="true" />
          <input ref={search} type="search" aria-label="Buscar escenarios" placeholder="Buscar por título, ID o paso…" value={query} onChange={event => setQuery(event.target.value)} />
          <kbd>Ctrl K</kbd>
        </label>
        <div className="scenario-segments" role="group" aria-label="Filtrar por resultados">
          {([['all', `Todos (${items.length})`], ['results', `Con resultados (${withResults})`], ['pending', `Sin resultados (${items.length - withResults})`]] as const).map(([value, label]) =>
            <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}
        </div>
      </div>
      <div className="scenario-toolbar__bottom">
        <div className="scenario-tag-filters" role="group" aria-label="Filtrar por etiqueta">
          <button type="button" aria-pressed={!tag} onClick={() => setTag('')}>Todos ({items.length})</button>
          {tags.map(value => <button type="button" key={value} className={/^@flujo/i.test(value) ? 'scenario-tag-filter--flow' : ''}
            aria-pressed={tag === value} onClick={() => setTag(tag === value ? '' : value)}>{value} ({items.filter(item => item.tags?.includes(value)).length})</button>)}
        </div>
        <label className="scenario-select-all"><input ref={selectAll} type="checkbox" checked={allChecked} disabled={!filtered.length} onChange={toggleVisible} />Seleccionar visibles ({filtered.length})</label>
        <span className="scenario-selection-count" role="status">{checked.size} seleccionados · {filtered.length} visibles</span>
      </div>
    </section>
    <div className={`scenario-workspace${active ? '' : ' scenario-workspace--list-only'}`}>
      <div className="scenario-list-region">
        <ul className="scenario-results" aria-label="Escenarios del proyecto">
          {filtered.map(item => {
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
          {items.length > 0 && <button type="button" className="secondary" onClick={() => { setQuery(''); setTag(''); setMode('all'); }}>Limpiar filtros</button>}
        </div>}
      </div>
      {active && <aside className="scenario-detail" aria-label="Detalle del escenario seleccionado">
        <header className="scenario-detail__head"><div><span>{active.id.slice(0, 8)}</span><h2>Detalle del escenario</h2></div>
          <div className="scenario-detail__controls">
            {onRun && <button type="button" aria-label="Ejecutar escenario seleccionado" onClick={() => onRun([active])}><PlayCircle size={16} /></button>}
            <button type="button" aria-label="Cerrar detalle del escenario" onClick={() => { setActiveId(null); setEditing(false); }}><X size={16} /></button>
          </div>
        </header>
        <div className="scenario-detail__body">
          {editing ? <ul className="scenario-editor-list"><ScenarioCard key={active.id} projectId={projectId} scenario={active} initialEditing
            onChange={onChange} onEditComplete={() => setEditing(false)} role={role} /></ul> : <>
            <h3>{active.title}</h3>
            <p className="scenario-detail__source"><FileText size={14} />{active.requirement ? `${active.requirement.externalKey ? active.requirement.externalKey + ' / ' : ''}${active.requirement.title}` : 'Sin requisito asociado'}</p>
            <div className="scenario-detail__section-label"><span>Especificación BDD (vista derivada)</span><Code2 size={14} /></div>
            <div className="scenario-gherkin"><ol>{(active.steps ?? []).map((step, i) => <li key={i}>
              <span className="scenario-gherkin__keyword">{gherkinKeyword(step, active.steps?.[i - 1])}</span>
              <div>{step.action}{step.data && <p><span>Dato:</span> <code>{step.data}</code></p>}{step.expected && <p><span>Esperado:</span> {step.expected}</p>}</div>
            </li>)}</ol>{!active.steps?.length && <p>No hay pasos registrados.</p>}</div>
            <p className="scenario-derived-note">Palabras clave inferidas de las acciones. Revisa esta vista antes de utilizarla como especificación.</p>
            <section className="scenario-expected"><h4>Resultado esperado registrado</h4><p>{active.expectedResult ?? 'No declarado. Pendiente de definir.'}</p></section>
            <div className="scenario-detail__actions">{canEdit && <button type="button" className="secondary" onClick={() => setEditing(true)}><Pencil size={13} />Editar escenario</button>}
              <Link href={`/projects/${projectId}/scenarios/${active.id}`}><ExternalLink size={13} />Abrir ficha y ejecuciones</Link></div>
          </>}
        </div>
      </aside>}
    </div>
  </>;
}

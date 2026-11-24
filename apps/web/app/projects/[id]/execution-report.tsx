'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { Activity, ChevronDown, Clock, Download, Filter, HelpCircle, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Project } from '../onboarding';
import type { ScenarioListItem } from './scenario-card';
import { isReportableRunStatus, REPORT_WHILE_RUNNING, REPORT_WITHOUT_RUNS } from '../../../../api/src/runs/run-report-policy';
import { QualityResultsReport } from './quality-results-report';
import { ProjectHeading } from './project-heading';
import { useReportHeader } from './project-tabs';
import { hasRunActivity, readRunActivity, useReportActivity } from './run-activity';
import { primaryReportTags, dateText, downloadRunReport, durationText, outcome, reportStatistics, resultDuration, runTitle, type ReportRun } from './run-report-data';
import { category, filterLabels, RunDetail, RunMatrix, RunsTable, RunTimeline, type RunFilter } from './run-report-views';
import { ScenarioPagination, useScenarioPagination } from './scenario-pagination';

type ReportOverview = { latest: ReportRun[]; history: ReportRun[] };

export function ExecutionReport({ project }: { project: Project }) {
  const header = useReportHeader();
  const activity = useReportActivity(project.id, !!header?.active);
  const [reportMode, setReportMode] = useState<'all' | 'scenarios' | 'quality'>('all');
  const showScenarios = reportMode !== 'quality';
  const showQuality = reportMode !== 'scenarios';
  const [overview, setOverview] = useState<ReportOverview | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioListItem[] | null>(null);
  const [error, setError] = useState('');
  const [tagsWarning, setTagsWarning] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [scope, setScope] = useState('latest');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RunFilter>('all');
  const [tag, setTag] = useState('');
  const [view, setView] = useState<'table' | 'timeline' | 'matrix'>('table');
  const [detailId, setDetailId] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const tagMenu = useRef<HTMLDetailsElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const latest = overview?.latest ?? [];
  const history = overview?.history ?? [];
  const waiting = activity.waiting || latest.some(run => !isReportableRunStatus(run.status))
    || history.some(run => !isReportableRunStatus(run.status));
  const refreshOnActivity = waiting ? activity.counts : null;

  useEffect(() => {
    if (!header?.active) return;
    const mode = new URLSearchParams(window.location.search).get('resultados');
    setReportMode(mode === 'calidad' ? 'quality' : mode === 'escenarios' ? 'scenarios' : 'all');
  }, [header?.active]);

  useEffect(() => {
    if (!header?.active || !showScenarios) return;
    const controller = new AbortController();
    const options = { cache: 'no-store' as const, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) };
    setLoading(true); setError(''); setTagsWarning('');
    Promise.allSettled([
      fetch(`/api/projects/${project.id}/runs?view=overview`, options), fetch(`/api/projects/${project.id}/scenarios`, options),
    ]).then(async ([report, catalog]) => {
      if (report.status !== 'fulfilled') throw new Error('No se pudo consultar el historial de ejecuciones.');
      if (!report.value.ok) throw new Error(report.value.status === 403
        ? 'No tienes permiso para consultar este historial o tu plan no lo permite.' : 'No se pudo consultar el historial de ejecuciones.');
      const data: ReportOverview = await report.value.json();
      if (!Array.isArray(data?.latest) || !Array.isArray(data?.history)) {
        throw new Error('No se pudo consultar el historial de ejecuciones.');
      }
      if (controller.signal.aborted) return;
      setOverview(data);
      setScope(previous => previous === 'latest' || previous === 'all' || data.history.some(run => run.id === previous)
        ? previous : 'latest');
      setDetailId(previous => data.history.some(run => run.id === previous) || data.latest.some(run => run.id === previous)
        ? previous : null);
      if (catalog.status === 'fulfilled' && catalog.value.ok) {
        const list: ScenarioListItem[] = await catalog.value.json();
        if (!controller.signal.aborted) setScenarios(list);
      } else {
        setScenarios(null); setTagsWarning('Las etiquetas actuales no están disponibles.');
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo cargar el reporte.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project.id, header?.active, showScenarios, refresh, activity.historyVersion, refreshOnActivity]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'k' || !search.current?.getClientRects().length) return;
      event.preventDefault(); search.current.focus();
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    const menus = [tagMenu, exportMenu];

    function closeOnOutside(event: PointerEvent) {
      for (const { current: menu } of menus) {
        if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      for (const { current: menu } of menus) {
        if (!menu?.open) continue;
        const restoreFocus = menu.contains(document.activeElement);
        menu.open = false;
        if (restoreFocus) menu.querySelector('summary')?.focus();
      }
    }

    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  function pickReport(mode: typeof reportMode) {
    const url = new URL(window.location.href);
    if (mode === 'all') url.searchParams.delete('resultados');
    else url.searchParams.set('resultados', mode === 'quality' ? 'calidad' : 'escenarios');
    window.history.replaceState(window.history.state, '', url);
    setReportMode(mode);
  }

  function pickTag(next: string) {
    setTag(next);
    if (tagMenu.current) tagMenu.current.open = false;
  }

  const showLatest = scope === 'latest';
  const scopeLabel = showLatest ? 'escenarios' : 'ejecuciones';
  const scoped = showLatest ? latest : history.filter(run => scope === 'all' || run.id === scope);
  const stats = reportStatistics(scoped);
  const allTags = new Map((scenarios ?? []).map(scenario => [scenario.id, scenario.tags ?? []]));
  const tags = new Map(Array.from(allTags, ([id, values]) => [id, primaryReportTags(values)]));
  const availableTags = [...new Set(scoped.flatMap(run => run.scenarioId ? tags.get(run.scenarioId) ?? [] : []))].sort();
  const normalized = query.trim().toLocaleLowerCase('es');
  const filteredRuns = scoped.filter(run => (filter === 'all' || category(run) === filter)
    && (!tag || (run.scenarioId && tags.get(run.scenarioId)?.includes(tag)))
    && (!normalized || [runTitle(run), run.id, run.scenarioId ?? '', run.errorCode ?? '', run.targetBrowser ?? '',
      ...(run.results.map(result => result.errorMessage ?? '')), ...(run.scenarioId ? allTags.get(run.scenarioId) ?? [] : [])]
      .join(' ').toLocaleLowerCase('es').includes(normalized)));
  const { visible: pagedRuns, results: listRef, resetPage, pagination } = useScenarioPagination<ReportRun, HTMLDivElement>(filteredRuns);
  const detail = scoped.find(run => run.id === detailId);
  const filters = Object.keys(filterLabels) as RunFilter[];
  const finalized = filteredRuns.filter(run => isReportableRunStatus(run.status));
  useEffect(() => { resetPage(); }, [filter, tag, query, scope, view, resetPage]);
  const hasFinalized = latest.some(run => isReportableRunStatus(run.status)) || history.some(run => isReportableRunStatus(run.status));
  const canGenerate = activity.verified && !waiting && !loading && !error && hasFinalized;
  const downloadDisabled = exporting || !canGenerate || !finalized.length;
  const exportNotice = waiting ? REPORT_WHILE_RUNNING
    : activity.statusMessage || (!loading && !error && !hasFinalized ? REPORT_WITHOUT_RUNS : '');

  async function exportResults(event: MouseEvent<HTMLButtonElement>, format: 'xml' | 'json' | 'zip') {
    if (downloadDisabled) return;
    const menu = event.currentTarget.closest('details');
    setExporting(true);
    setExportError('');
    try {
      if (hasRunActivity(await readRunActivity(project.id))) {
        setExportError(REPORT_WHILE_RUNNING);
        return;
      }
      if (format === 'zip') {
        // Reporte consolidado estilo SerenityBDD: el browser descarga directo
        // el zip que el API genera (hasta 200 runs). Usamos window.location
        // porque es un stream grande y evitar un fetch que acumule en memoria.
        const ids = finalized.map(run => run.id).slice(0, 200).join(',');
        window.location.href = `/api/projects/${project.id}/runs/export-report?ids=${encodeURIComponent(ids)}`;
      } else {
        downloadRunReport(project.id, finalized, format);
      }
      menu?.removeAttribute('open');
    } catch {
      setExportError('No se pudo confirmar el estado de las ejecuciones.');
    } finally {
      setExporting(false);
    }
  }

  return <section className="run-report" aria-label="Reporte de ejecuciones">
    {header?.element && createPortal(<ProjectHeading project={project}
      summary="Consulta las ejecuciones de escenarios y los resultados de Disponibilidad, Lighthouse, k6 y UX."
      actions={showScenarios && <details ref={exportMenu} className="run-report-export"><summary><Download size={14} />Exportar resultados</summary>
        <div><button type="button" disabled={downloadDisabled} onClick={event => void exportResults(event, 'xml')}>Exportar JUnit XML</button>
          <button type="button" disabled={downloadDisabled} onClick={event => void exportResults(event, 'json')}>Exportar JSON</button>
          <button type="button" disabled={downloadDisabled} onClick={event => void exportResults(event, 'zip')}>Reporte completo (.zip)</button>
          <small>{exportNotice || `Exporta las ${finalized.length} ejecuciones finalizadas visibles.`}</small></div></details>} />, header.element)}
    <div className="run-report-filter-options quality-report-switch" role="group" aria-label="Tipo de resultados">
      <button type="button" aria-pressed={reportMode === 'all'} onClick={() => pickReport('all')}>Todas</button>
      <button type="button" aria-pressed={reportMode === 'scenarios'} onClick={() => pickReport('scenarios')}>Escenarios</button>
      <button type="button" aria-pressed={reportMode === 'quality'} onClick={() => pickReport('quality')}>Calidad</button>
    </div>
    {showScenarios && <section aria-label="Resultados de escenarios">
    {exportError && <p className="run-report-warning" role="alert">{exportError}</p>}
    {loading && !overview ? <p className="run-report-message" role="status">Consultando reporte de ejecuciones…</p>
      : error ? <div className="run-report-message" role="alert"><p className="error">{error}</p><button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Reintentar reporte</button></div>
      : <>
        <div className="run-report-metrics">
          <section aria-label="Tasa de éxito"><header><h2>Tasa de éxito</h2><Activity size={16} /></header>
            <p className="run-report-metric-value"><strong>{stats.rate === null ? 'Sin resultados' : `${Number(stats.rate.toFixed(1))}%`}</strong><span>{stats.counts.PASSED}/{stats.results} resultados aprobados</span></p>
            <div className="run-report-success-bar" role="img" aria-label={`${stats.counts.PASSED} aprobados, ${stats.counts.FAILED} fallidos, ${stats.counts.BLOCKED} bloqueados y ${stats.counts.SKIPPED} omitidos`}>
              {(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const).map(status => <span key={status} className={`run-bar-${status.toLowerCase()}`} style={{ width: `${stats.results ? 100 * stats.counts[status] / stats.results : 0}%` }} />)}
            </div><small>{stats.counts.FAILED} fallidos · {stats.counts.BLOCKED} bloqueados · {stats.counts.SKIPPED} omitidos</small>
          </section>
          <section aria-label="Tiempo registrado"><header><h2>Tiempo registrado</h2><Clock size={16} /></header>
            <p className="run-report-metric-value"><strong>{durationText(stats.duration)}</strong></p>
            <p>Suma de duraciones de resultados.</p><small>{stats.timed}/{stats.results} resultados con duración registrada. No equivale al tiempo de pared de una suite.</small>
          </section>
          <section aria-label="Flakiness y reintentos"><header><h2>Flakiness y reintentos</h2><HelpCircle size={16} /></header>
            <p className="run-report-metric-value"><strong>No disponible</strong></p><p>No hay medición registrada.</p><small>No se infiere estabilidad ni número de reintentos a partir de este historial.</small>
          </section>
          <section aria-label="Cobertura de aserciones"><header><h2>Cobertura de aserciones</h2><ShieldCheck size={16} /></header>
            <p className="run-report-metric-value"><strong>No disponible</strong></p><p>Sin contador de aserciones.</p><small>La cantidad de resultados no demuestra cobertura de requisitos, API o DOM.</small>
          </section>
        </div>
        <section className="run-report-filters" aria-label="Filtros del reporte">
          <div><label className="run-report-search"><Search size={14} /><input ref={search} type="search" aria-label="Buscar ejecuciones" placeholder="Filtrar por escenario, ID, etiqueta o error…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>Ctrl K</kbd></label>
            <div className="run-report-views" role="group" aria-label="Vista del reporte"><span>Vista:</span>{([['table', 'Ejecuciones'], ['timeline', 'Cronología'], ['matrix', 'Matriz']] as const).map(([id, label]) =>
              <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div></div>
          <div className="run-report-filter-row">
            {availableTags.length > 0 && <details ref={tagMenu} className="run-report-tag-menu">
              <summary aria-label="Filtrar por etiqueta actual del escenario">
                <Filter size={14} aria-hidden="true" />
                <span>{tag ? tag : `Todas las etiquetas (${availableTags.length})`}</span>
                <ChevronDown size={14} aria-hidden="true" className="run-report-tag-menu__chevron" />
              </summary>
              <div className="run-report-tag-menu__options" role="group" aria-label="Opciones de etiqueta">
                <button type="button" aria-pressed={!tag} onClick={() => pickTag('')}>Todas ({availableTags.length})</button>
                {availableTags.map(value => <button type="button" key={value} aria-pressed={tag === value}
                  onClick={() => pickTag(tag === value ? '' : value)}>{value}</button>)}
              </div>
            </details>}
            <div className="run-report-filter-options" role="group" aria-label="Estado de ejecución">{filters.map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {filterLabels[value]} ({value === 'all' ? scoped.length : scoped.filter(run => category(run) === value).length})
            </button>)}</div>
          </div>
          <p role="status">{filteredRuns.length} de {scoped.length} {scopeLabel} visibles.</p>
        </section>
        {tagsWarning && <p className="run-report-warning">{tagsWarning}</p>}
        <div className="run-report-content"><div className="run-report-main">
          {!filteredRuns.length ? <div className="run-report-empty"><Activity size={28} /><h3>{scoped.length ? 'No hay ejecuciones que coincidan' : 'Aún no hay ejecuciones registradas'}</h3>
            <p>{scoped.length ? 'Ajusta los filtros del reporte.' : 'Los resultados aparecerán después de ejecutar escenarios autorizados.'}</p>
            {scoped.length ? <button type="button" className="secondary" onClick={() => { setQuery(''); setFilter('all'); setTag(''); }}>Limpiar filtros del reporte</button> : <a href="#automatizacion">Preparar una ejecución →</a>}</div>
            : <>
              <div ref={listRef} tabIndex={-1} className="run-report-results" aria-label="Resultados del reporte">
                {view === 'timeline' ? <RunTimeline runs={pagedRuns} onDetail={setDetailId} />
                  : view === 'matrix' ? <RunMatrix runs={pagedRuns} />
                  : <RunsTable projectId={project.id} runs={pagedRuns} tags={tags} tagsAvailable={scenarios !== null} detailId={detailId} onDetail={setDetailId} />}
              </div>
              <ScenarioPagination label="Paginación del reporte" {...pagination} />
            </>}
          <p className="run-report-data-note">Las etiquetas corresponden a la configuración actual de cada escenario.</p>
          {canGenerate && <Link className="run-report-consolidated" href={`/projects/${project.id}/report`}>Abrir reporte consolidado de calidad →</Link>}
        </div><aside className="run-report-aside" aria-label="Historial y detalle de ejecuciones">
          {detail && <RunDetail run={detail} projectId={project.id} onClose={() => { setDetailId(null); setScope('latest'); }} />}
          <section className="run-report-history"><header><h2>Ejecuciones recientes</h2></header>
            {!history.length ? <p>No hay historial disponible.</p> : <ol>{history.slice(0, 8).map(run => { const status = outcome(run); return <li key={run.id}>
              <button type="button" aria-pressed={scope === run.id} aria-label={`Seleccionar ejecución ${run.id.slice(0, 8)}`} onClick={() => { setScope(run.id); setDetailId(run.id); setFilter('all'); setTag(''); setQuery(''); }}>
                <span><code>{run.id.slice(0, 8)}</code><span className={`run-report-state run-report-state--${status.tone}`}>{status.label}</span></span>
                <strong>{runTitle(run)}</strong><small>{dateText(run.createdAt)} · {durationText(resultDuration(run))}</small>
              </button></li>; })}</ol>}
          </section>
        </aside></div>
      </>}
    </section>}
    {showQuality && <QualityResultsReport projectId={project.id} active={!!header?.active} refreshKey={activity.historyVersion} />}
  </section>;
}

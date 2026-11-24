'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import type { OrgRole } from '../../autoqa-server';
import type { Project } from '../onboarding';
import type { GeneratedSpec } from './automation-export';
import type { ScenarioListItem } from './scenario-card';
import { ProjectHeading } from './project-heading';
import { ScenarioRunDialog, type ScenarioSuiteControl } from './scenario-run-dialog';
import type { SuiteResult } from './scenario-suite';

type ScenarioSpecs = Record<string, GeneratedSpec>;
type SuiteCandidates = { scenarios: ScenarioListItem[]; qualityScenarios: ScenarioListItem[] };
type SuiteSelection = SuiteCandidates & { initialIds: string[] };

const ScenarioSuiteContext = createContext<{
  open: (scenarios: ScenarioListItem[], qualityScenarios?: ScenarioListItem[], candidates?: SuiteCandidates) => void;
  hasSuite: boolean;
  suiteRunning: boolean;
  progress: SuiteResult[] | null;
  trackingWarning: string;
  stopping: boolean;
  stop: () => Promise<void>;
  historyVersion: number;
} | null>(null);
export function useScenarioSuite() { return useContext(ScenarioSuiteContext); }

const ScenarioHeaderContext = createContext<{
  element: HTMLDivElement | null;
  active: boolean;
  setCount: (count: number | null) => void;
  specs: ScenarioSpecs;
} | null>(null);
export function useScenarioHeader() { return useContext(ScenarioHeaderContext); }
const ScenarioQualityContext = createContext<{
  items: ScenarioListItem[];
  error: boolean;
  reload: () => Promise<void>;
  updateAutomation: (id: string, automation: NonNullable<ScenarioListItem['quality']>['automation']) => void;
}>({ items: [], error: false, reload: async () => {}, updateAutomation: () => {} });
export function useScenarioQuality() { return useContext(ScenarioQualityContext); }
const AutomationHeaderContext = createContext<{
  element: HTMLDivElement | null;
  active: boolean;
  specs: ScenarioSpecs;
  setSpecs: (specs: ScenarioSpecs) => void;
} | null>(null);
export function useAutomationHeader() { return useContext(AutomationHeaderContext); }
const ReportHeaderContext = createContext<{ element: HTMLDivElement | null; active: boolean } | null>(null);
export function useReportHeader() { return useContext(ReportHeaderContext); }
const QualityHeaderContext = createContext<{ element: HTMLDivElement | null; active: boolean } | null>(null);
export function useQualityHeader() { return useContext(QualityHeaderContext); }
const ExplorationHeaderContext = createContext<{ element: HTMLDivElement | null; active: boolean } | null>(null);
export function useExplorationHeader() { return useContext(ExplorationHeaderContext); }

const TABS = [
  { id: 'datos', label: 'Datos' },
  { id: 'escenarios', label: 'Escenarios' },
  { id: 'automatizacion', label: 'Automatización' },
  { id: 'reporte', label: 'Reportes' },
  { id: 'calidad', label: 'Calidad' },
  { id: 'historial', label: 'Historial' },
  { id: 'exploracion', label: 'Exploración' },
] as const;

export type TabId = typeof TABS[number]['id'];

// Mantiene la pestaña activa en el hash de la URL para que el back del
// navegador funcione y el link sea compartible. Si el hash no coincide con
// ninguna pestaña o la pestaña no se renderizó (ej. exploración oculta por
// plan), cae a "datos".
function readHashTab(available: TabId[]): TabId {
  if (typeof window === 'undefined') return 'datos';
  const raw = window.location.hash.replace(/^#/, '');
  return (available as string[]).includes(raw) ? (raw as TabId) : 'datos';
}

export function ProjectTabs({
  project,
  role,
  showExploration,
  context,
  showScheduleButton,
  children,
}: {
  project: Project;
  role?: OrgRole;
  showExploration: boolean;
  context?: ReactNode;
  showScheduleButton: boolean;
  children: Partial<Record<TabId, ReactNode>>;
}) {
  const visible: TabId[] = TABS.map(t => t.id).filter(id => id !== 'exploracion' || showExploration);
  const [active, setActive] = useState<TabId>('datos');
  const tabGroup = useId();
  const [headerElement, setHeaderElement] = useState<HTMLDivElement | null>(null);
  const [scenarioCount, setScenarioCount] = useState<number | null>(null);
  const [qualityItems, setQualityItems] = useState<ScenarioListItem[]>([]);
  const [qualityError, setQualityError] = useState(false);
  const [specs, setSpecs] = useState<ScenarioSpecs>({});
  const [runSelection, setRunSelection] = useState<SuiteSelection | null>(null);
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [suiteProgress, setSuiteProgress] = useState<SuiteResult[] | null>(null);
  const [suiteTrackingWarning, setSuiteTrackingWarning] = useState('');
  const [stopping, setStopping] = useState(false);
  const stopRequest = useRef(false);
  const suiteControl = useRef<ScenarioSuiteControl>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const hasSuite = runSelection !== null;
  const qualityRequest = useRef(0);
  const loadQuality = useCallback(async () => {
    const request = ++qualityRequest.current;
    try {
      const response = await fetch(`/api/projects/${project.id}/scenarios/quality`, {
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok && response.status !== 403) throw new Error('No se pudieron consultar las pruebas de calidad.');
      const list: ScenarioListItem[] = response.ok ? await response.json() : [];
      if (!Array.isArray(list)) throw new Error('Listado de calidad no válido.');
      if (request === qualityRequest.current) {
        setQualityItems(list);
        setQualityError(false);
      }
    } catch {
      if (request === qualityRequest.current) setQualityError(true);
    }
  }, [project.id]);
  useEffect(() => {
    void loadQuality();
    return () => { qualityRequest.current++; };
  }, [loadQuality]);
  useEffect(() => {
    if (!qualityItems.some(item => item.quality?.status.tone === 'pending')) return;
    const timer = setTimeout(() => void loadQuality(), 5000);
    return () => clearTimeout(timer);
  }, [loadQuality, qualityItems]);
  const updateQualityAutomation = useCallback((id: string, automation: NonNullable<ScenarioListItem['quality']>['automation']) => {
    qualityRequest.current++;
    setQualityItems(items => items.map(item => item.id === id && item.quality
      ? { ...item, quality: { ...item.quality, automation } }
      : item));
  }, []);
  const scenarioQuality = useMemo(() => ({
    items: qualityItems, error: qualityError, reload: loadQuality, updateAutomation: updateQualityAutomation,
  }), [qualityItems, qualityError, loadQuality, updateQualityAutomation]);
  const openSuite = useCallback((scenarios: ScenarioListItem[], qualityScenarios: ScenarioListItem[] = [], candidates?: SuiteCandidates) => {
    if (stopRequest.current) return;
    setRunSelection(current => current ?? {
      ...(candidates ?? { scenarios, qualityScenarios }),
      initialIds: [...scenarios, ...qualityScenarios].map(scenario => scenario.id),
    });
    setSuiteOpen(true);
  }, []);
  const stopSuite = useCallback(async () => {
    if (stopRequest.current) return;
    stopRequest.current = true;
    setStopping(true);
    try {
      await suiteControl.current?.stop();
      setSuiteOpen(false);
      setRunSelection(null);
      setSuiteRunning(false);
      setSuiteProgress(null);
      setSuiteTrackingWarning('');
      const response = await fetch(`/api/projects/${project.id}/runs/cancel`, {
        method: 'POST', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('No se pudo detener la ejecución.');
      setHistoryVersion(version => version + 1);
      void loadQuality();
    } finally {
      stopRequest.current = false;
      setStopping(false);
    }
  }, [project.id, loadQuality]);
  const suiteContext = useMemo(() => ({
    open: openSuite, hasSuite, suiteRunning, progress: suiteProgress, trackingWarning: suiteTrackingWarning, stopping, stop: stopSuite, historyVersion,
  }), [openSuite, hasSuite, suiteRunning, suiteProgress, suiteTrackingWarning, stopping, stopSuite, historyVersion]);
  const scenarioHeader = useMemo(() => ({ element: headerElement, active: active === 'escenarios', setCount: setScenarioCount, specs }),
    [headerElement, active, specs]);
  const [automationElement, setAutomationElement] = useState<HTMLDivElement | null>(null);
  const automationHeader = useMemo(() => ({ element: automationElement, active: active === 'automatizacion', specs, setSpecs }), [automationElement, active, specs]);
  const [reportElement, setReportElement] = useState<HTMLDivElement | null>(null);
  const reportHeader = useMemo(() => ({ element: reportElement, active: active === 'reporte' }), [reportElement, active]);
  const [qualityElement, setQualityElement] = useState<HTMLDivElement | null>(null);
  const qualityHeader = useMemo(() => ({ element: qualityElement, active: active === 'calidad' }), [qualityElement, active]);
  const [explorationElement, setExplorationElement] = useState<HTMLDivElement | null>(null);
  const explorationHeader = useMemo(() => ({ element: explorationElement, active: active === 'exploracion' }), [explorationElement, active]);

  useEffect(() => {
    setActive(readHashTab(visible));
    function onHash() { setActive(readHashTab(visible)); }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [visible.join(',')]);

  function select(id: TabId) {
    setActive(id);
    if (typeof window !== 'undefined') {
      history.replaceState(null, '', `#${id}`);
    }
  }

  function closeSuite() {
    setSuiteOpen(false);
    setRunSelection(null);
  }

  function viewSuiteReport(qualityOnly: boolean) {
    closeSuite();
    const url = new URL(window.location.href);
    if (qualityOnly) url.searchParams.set('resultados', 'calidad');
    else url.searchParams.delete('resultados');
    history.replaceState(window.history.state, '', url);
    select('reporte');
    requestAnimationFrame(() => document.getElementById(`${tabGroup}-reporte-tab`)?.focus());
  }

  return (
    <ScenarioSuiteContext.Provider value={suiteContext}>
    <ScenarioHeaderContext.Provider value={scenarioHeader}>
    <ScenarioQualityContext.Provider value={scenarioQuality}>
    <AutomationHeaderContext.Provider value={automationHeader}>
    <ReportHeaderContext.Provider value={reportHeader}>
    <QualityHeaderContext.Provider value={qualityHeader}>
    <ExplorationHeaderContext.Provider value={explorationHeader}>
      {(active === 'datos' || active === 'historial') &&
        <ProjectHeading project={project} showScheduleButton={active === 'datos' && showScheduleButton}
          showSpecificationExport={active === 'historial'} />}
      <div ref={setHeaderElement} hidden={active !== 'escenarios'} className="scenario-heading-slot" />
      <div ref={setAutomationElement} hidden={active !== 'automatizacion'} className="automation-heading-slot" />
      <div ref={setReportElement} hidden={active !== 'reporte'} className="report-heading-slot" />
      <div ref={setQualityElement} hidden={active !== 'calidad'} className="quality-heading-slot" />
      <div ref={setExplorationElement} hidden={active !== 'exploracion'} className="exploration-heading-slot" />
      <nav className="project-tabs" aria-label="Secciones del proyecto">
        <ul role="tablist">
          {TABS.filter(t => t.id !== 'exploracion' || showExploration).map(tab => (
            <li key={tab.id}>
              <button type="button" role="tab" aria-selected={active === tab.id}
                id={`${tabGroup}-${tab.id}-tab`} aria-controls={`${tabGroup}-${tab.id}-panel`}
                tabIndex={active === tab.id ? 0 : -1}
                onKeyDown={event => {
                  const index = visible.indexOf(tab.id);
                  const next = event.key === 'ArrowRight' ? visible[(index + 1) % visible.length]
                    : event.key === 'ArrowLeft' ? visible[(index - 1 + visible.length) % visible.length]
                    : event.key === 'Home' ? visible[0] : event.key === 'End' ? visible[visible.length - 1] : null;
                  if (!next) return;
                  event.preventDefault();
                  select(next);
                  document.getElementById(`${tabGroup}-${next}-tab`)?.focus();
                }}
                className={active === tab.id ? 'current' : ''}
                onClick={() => select(tab.id)}>
                {tab.label}{tab.id === 'escenarios' && scenarioCount !== null ? ` (${scenarioCount})` : ''}
              </button>
            </li>
          ))}
        </ul>
        {context}
      </nav>
      {visible.map(id => (
        <div key={id} role="tabpanel" id={`${tabGroup}-${id}-panel`} aria-labelledby={`${tabGroup}-${id}-tab`} hidden={active !== id}>
          {children[id]}
        </div>
      ))}
      {runSelection && <ScenarioRunDialog project={project} role={role} scenarios={runSelection.scenarios} qualityScenarios={runSelection.qualityScenarios} initialIds={runSelection.initialIds} specs={specs}
        control={suiteControl} open={suiteOpen} onHide={() => setSuiteOpen(false)}
        onClose={closeSuite} onViewReport={viewSuiteReport} onRunningChange={setSuiteRunning}
        onQualitySaved={scenario => {
          qualityRequest.current++;
          setQualityItems(items => items.map(item => item.id === scenario.id ? scenario : item));
          setRunSelection(current => current && { ...current,
            qualityScenarios: current.qualityScenarios.map(item => item.id === scenario.id ? scenario : item),
          });
        }}
        onRunsChanged={() => { setHistoryVersion(version => version + 1); void loadQuality(); }}
        onProgress={setSuiteProgress} onTrackingWarning={setSuiteTrackingWarning} />}
    </ExplorationHeaderContext.Provider>
    </QualityHeaderContext.Provider>
    </ReportHeaderContext.Provider>
    </AutomationHeaderContext.Provider>
    </ScenarioQualityContext.Provider>
    </ScenarioHeaderContext.Provider>
    </ScenarioSuiteContext.Provider>
  );
}

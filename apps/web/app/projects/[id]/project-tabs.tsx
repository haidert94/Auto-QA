'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import type { OrgRole } from '../../autoqa-server';
import type { Project } from '../onboarding';
import type { GeneratedSpec } from './automation-export';
import type { ScenarioListItem } from './scenario-card';
import { ScenarioRunDialog } from './scenario-run-dialog';

type ScenarioSpecs = Record<string, GeneratedSpec>;

const ScenarioSuiteContext = createContext<{
  open: (scenarios: ScenarioListItem[]) => void;
  hasSuite: boolean;
  historyVersion: number;
} | null>(null);
export function useScenarioSuite() { return useContext(ScenarioSuiteContext); }

const ScenarioHeaderContext = createContext<{
  element: HTMLDivElement | null;
  setCount: (count: number | null) => void;
  specs: ScenarioSpecs;
} | null>(null);
export function useScenarioHeader() { return useContext(ScenarioHeaderContext); }
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
  { id: 'reporte', label: 'Reporte' },
  { id: 'calidad', label: 'Calidad' },
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
  heading,
  children,
}: {
  project: Project;
  role?: OrgRole;
  showExploration: boolean;
  context?: ReactNode;
  heading?: ReactNode;
  children: Partial<Record<TabId, ReactNode>>;
}) {
  const visible: TabId[] = TABS.map(t => t.id).filter(id => id !== 'exploracion' || showExploration);
  const [active, setActive] = useState<TabId>('datos');
  const tabGroup = useId();
  const [headerElement, setHeaderElement] = useState<HTMLDivElement | null>(null);
  const [scenarioCount, setScenarioCount] = useState<number | null>(null);
  const [specs, setSpecs] = useState<ScenarioSpecs>({});
  const [runSelection, setRunSelection] = useState<ScenarioListItem[] | null>(null);
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const hasSuite = runSelection !== null;
  const openSuite = useCallback((scenarios: ScenarioListItem[]) => {
    setRunSelection(current => current ?? scenarios);
    setSuiteOpen(true);
  }, []);
  const suiteContext = useMemo(() => ({ open: openSuite, hasSuite, historyVersion }), [openSuite, hasSuite, historyVersion]);
  const scenarioHeader = useMemo(() => ({ element: headerElement, setCount: setScenarioCount, specs }), [headerElement, specs]);
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

  return (
    <ScenarioSuiteContext.Provider value={suiteContext}>
    <ScenarioHeaderContext.Provider value={scenarioHeader}>
    <AutomationHeaderContext.Provider value={automationHeader}>
    <ReportHeaderContext.Provider value={reportHeader}>
    <QualityHeaderContext.Provider value={qualityHeader}>
    <ExplorationHeaderContext.Provider value={explorationHeader}>
      {!['escenarios', 'automatizacion', 'reporte', 'calidad', 'exploracion'].includes(active) && heading}
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
      {runSelection && <ScenarioRunDialog project={project} role={role} scenarios={runSelection} specs={specs}
        open={suiteOpen} onHide={() => setSuiteOpen(false)} onClose={() => { setSuiteOpen(false); setRunSelection(null); }}
        onRunsChanged={() => setHistoryVersion(version => version + 1)} />}
    </ExplorationHeaderContext.Provider>
    </QualityHeaderContext.Provider>
    </ReportHeaderContext.Provider>
    </AutomationHeaderContext.Provider>
    </ScenarioHeaderContext.Provider>
    </ScenarioSuiteContext.Provider>
  );
}

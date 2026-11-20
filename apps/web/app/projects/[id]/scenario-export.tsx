'use client';

import { ChevronDown, Download } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ScenarioListItem } from './scenario-card';
import { featureText, isSensitiveScenarioStep } from './scenario-presentation';

const formats = [
  { extension: 'feature', label: 'Gherkin (.feature)', mime: 'text/plain;charset=utf-8' },
  { extension: 'csv', label: 'CSV (.csv)', mime: 'text/csv;charset=utf-8' },
  { extension: 'json', label: 'JSON (.json)', mime: 'application/json;charset=utf-8' },
] as const;

function csvCell(value: string) {
  const safe = /^[\t\r\n]|^\s*[=+@\-＝＋＠－]/u.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function csvText(scenarios: ScenarioListItem[]) {
  const headers = ['ID', 'Título', 'Requisito', 'Etiquetas', 'Pasos', 'Resultado esperado'];
  const rows = scenarios.map(scenario => [
    scenario.id,
    scenario.title,
    [scenario.requirement?.externalKey, scenario.requirement?.title].filter(Boolean).join(' / '),
    (scenario.tags ?? []).join(' '),
    (scenario.steps ?? []).map(step => [
      `${step.ordinal}. ${step.action}`,
      step.data ? `Dato: ${step.data}` : '',
      step.expected ? `Esperado: ${step.expected}` : '',
    ].filter(Boolean).join(' · ')).join('\n'),
    scenario.expectedResult ?? '',
  ]);
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function downloadScenarios(projectName: string, scenarios: ScenarioListItem[], format: typeof formats[number]) {
  const exported = scenarios.map(scenario => ({
    id: scenario.id,
    title: scenario.title,
    requirementId: scenario.requirementId,
    requirement: scenario.requirement ? {
      externalKey: scenario.requirement.externalKey,
      title: scenario.requirement.title,
    } : null,
    tags: scenario.tags ?? [],
    expectedResult: scenario.expectedResult,
    steps: (scenario.steps ?? []).map(step => ({
      ordinal: step.ordinal,
      action: step.action,
      data: isSensitiveScenarioStep(step) ? null : step.data ?? null,
      expected: step.expected ?? null,
    })),
  }));
  const content = format.extension === 'feature' ? featureText(projectName, exported)
    : format.extension === 'csv' ? csvText(exported)
    : JSON.stringify({ project: projectName, scenarios: exported }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: format.mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `autoqa-escenarios.${format.extension}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ScenarioExport({ projectName, scenarios }: { projectName: string; scenarios: ScenarioListItem[] }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionsId = useId();

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  return <div className="scenario-export" ref={container}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="secondary" disabled={!scenarios.length}
      aria-expanded={open} aria-controls={optionsId} onClick={() => setOpen(value => !value)}
      title="Exportar seleccionados, o todos si no hay selección">
      <Download size={14} aria-hidden="true" />Exportar<ChevronDown size={13} aria-hidden="true" />
    </button>
    <div className="scenario-export__options" id={optionsId} role="group" aria-label="Formatos de exportación" hidden={!open}>
      {formats.map(format => <button type="button" className="secondary" key={format.extension} onClick={() => {
        downloadScenarios(projectName, scenarios, format);
        setOpen(false);
        trigger.current?.focus();
      }}>{format.label}</button>)}
    </div>
  </div>;
}

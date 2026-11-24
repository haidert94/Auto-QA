'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { COMPATIBILITY_SCENARIO_TAGS } from '../../../../api/src/scenarios/scenario-tags';
import { TEST_TYPE_LABELS, type TestTypeCode } from '../document-client';
import type { ScenarioListItem } from './scenario-card';

const suiteTypes = ['functional_web', 'mobile_emulated', 'compatibility', 'availability', 'performance', 'ux'] as const satisfies readonly TestTypeCode[];
type SuiteType = (typeof suiteTypes)[number];
type Candidate = { scenario: ScenarioListItem; problem: string | null };
type ChangeSelection = (ids: readonly string[], checked: boolean) => void;

function testType(scenario: ScenarioListItem): SuiteType {
  const quality = scenario.quality?.kind;
  if (quality === 'lighthouse' || quality === 'load') return 'performance';
  if (quality) return quality;
  const tags = (scenario.tags ?? []).map(tag => tag.trim().toLowerCase());
  if (COMPATIBILITY_SCENARIO_TAGS.some(tag => tags.includes(tag))) return 'compatibility';
  return tags.includes('@mobile') ? 'mobile_emulated' : 'functional_web';
}

function SelectionCheckbox({ ids, selected, onChange, label, className, accessibleName }: {
  ids: string[]; selected: ReadonlySet<string>; onChange: ChangeSelection;
  label: string; className?: string; accessibleName?: string;
}) {
  const box = useRef<HTMLInputElement>(null);
  const count = ids.filter(id => selected.has(id)).length;
  const complete = ids.length > 0 && count === ids.length;
  const partial = count > 0 && !complete;
  useEffect(() => {
    if (box.current) box.current.indeterminate = partial;
  }, [partial]);

  return <label className={className ?? 'check'}>
    <input ref={box} type="checkbox" checked={complete} disabled={!ids.length} aria-label={accessibleName}
      onChange={event => onChange(ids, event.target.checked)} />
    {label}
  </label>;
}

export function ScenarioSuiteSelection({ candidates, selected, onChange, disabled }: {
  candidates: Candidate[]; selected: ReadonlySet<string>; onChange: ChangeSelection; disabled: boolean;
}) {
  const prefix = useId();
  const [expanded, setExpanded] = useState<SuiteType | null>(() => {
    const first = candidates.find(({ scenario }) => selected.has(scenario.id));
    return first ? testType(first.scenario) : null;
  });
  const groups = new Map<SuiteType, Candidate[]>(suiteTypes.map(type => [type, []]));
  for (const candidate of candidates) groups.get(testType(candidate.scenario))?.push(candidate);
  const runnableIds = candidates.filter(row => !row.problem).map(({ scenario }) => scenario.id);

  return <fieldset className="scenario-run-selection" disabled={disabled}>
    <legend>Pruebas para ejecutar</legend>
    {runnableIds.length > 1 && <SelectionCheckbox ids={runnableIds} selected={selected} onChange={onChange}
      label="Seleccionar todas" className="check scenario-run-select-all" />}
    <ul className="scenario-run-groups">
      {suiteTypes.map(type => {
        const group = groups.get(type) ?? [];
        const ids = group.filter(row => !row.problem).map(({ scenario }) => scenario.id);
        const count = ids.filter(id => selected.has(id)).length;
        const label = TEST_TYPE_LABELS[type];
        const open = expanded === type;
        const id = prefix + '-' + type;
        return <li key={type}>
          <div className="scenario-run-group-header">
            <SelectionCheckbox ids={ids} selected={selected} onChange={onChange}
              label={label} accessibleName={`Seleccionar ${label}`} />
            <span className="scenario-run-group-count">{ids.length ? `${count}/${ids.length}` : group.length ? 'Sin pruebas listas' : 'Sin pruebas'}</span>
            {group.length > 0 && <button type="button" className="secondary scenario-run-group-toggle"
              aria-label={`Ver pruebas de ${label}`} aria-expanded={open} aria-controls={id}
              onClick={() => setExpanded(open ? null : type)}><ChevronDown size={14} aria-hidden="true" /></button>}
          </div>
          {group.length > 0 && <ul id={id} className="scenario-run-targets" hidden={!open}>
            {group.map(({ scenario, problem }) => <li key={scenario.id}>
              <label className="check">
                <input type="checkbox" checked={!problem && selected.has(scenario.id)} disabled={!!problem}
                  onChange={event => onChange([scenario.id], event.target.checked)} />
                <span>{scenario.title}{problem && <small>{problem}</small>}</span>
              </label>
            </li>)}
          </ul>}
        </li>;
      })}
    </ul>
  </fieldset>;
}

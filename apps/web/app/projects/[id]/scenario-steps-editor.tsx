'use client';

import { useId, useMemo, useRef, useState } from 'react';
import type { ScenarioListItem, ScenarioStep } from './scenario-card';
import { GHERKIN_KEYWORDS, gherkinKeyword, scenarioStepText, type GherkinKeyword } from './scenario-presentation';

const MAX_STEPS = 50;
const MAX_ACTION_LENGTH = 1000;
const MAX_SUGGESTIONS = 6;

type StepText = { keyword: GherkinKeyword; text: string };
type DraftStep = StepText & { original?: StepText & { step: ScenarioStep } };
export type ScenarioStepSource = Pick<ScenarioListItem, 'title' | 'steps'>;

type SuggestedStep = { step: DraftStep; title: string; searchText: string; index: number };

export function scenarioStepDrafts(steps: ScenarioStep[] | null): DraftStep[] {
  return (steps ?? []).map((step, index) => {
    const keyword = gherkinKeyword(step, steps?.[index - 1]);
    const text = scenarioStepText(step);
    return { keyword, text, original: { keyword, text, step } };
  });
}

export function saveScenarioSteps(drafts: DraftStep[]) {
  if (!drafts.length || drafts.some(draft => !draft.text.trim())) {
    return { error: 'Escribe el texto de todos los pasos del escenario.' };
  }
  const steps = drafts.map(({ keyword, text, original }, index): ScenarioStep => {
    const ordinal = index + 1;
    if (original && keyword === original.keyword && text === original.text) {
      const { action, data, expected } = original.step;
      return { ordinal, action, data, expected };
    }
    return { ordinal, action: keyword + ' ' + text.replace(/\s*[\r\n\u2028\u2029]+\s*/gu, ' ').trim() };
  });
  if (steps.some(step => step.action.length > MAX_ACTION_LENGTH)) {
    return { error: 'Cada paso puede tener hasta 1.000 caracteres, incluida su palabra clave.' };
  }
  return { steps };
}

function normalizeStepSearch(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function buildStepCatalog(scenarios: ReadonlyArray<ScenarioStepSource>) {
  const catalog: SuggestedStep[] = [];
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    for (const step of scenarioStepDrafts(scenario.steps)) {
      const searchText = normalizeStepSearch(step.text);
      const stored = step.original?.step;
      const key = JSON.stringify([step.keyword, stored?.action, stored?.data, stored?.expected]);
      if (!searchText || seen.has(key)) continue;
      seen.add(key);
      catalog.push({ step, searchText, title: scenario.title, index: catalog.length });
    }
  }
  return catalog;
}

function StepTextField({ step, number, catalog, onChange }: {
  step: DraftStep;
  number: number;
  catalog: SuggestedStep[] | null;
  onChange: (step: DraftStep) => void;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const matches = useMemo(() => {
    const query = normalizeStepSearch(step.text);
    if (!query || !catalog) return [];
    const preferred: SuggestedStep[] = [];
    const alternatives: SuggestedStep[] = [];
    for (const candidate of catalog) {
      if (!candidate.searchText.includes(query)) continue;
      if (candidate.step.keyword === step.keyword) {
        preferred.push(candidate);
        if (preferred.length === MAX_SUGGESTIONS) break;
      } else if (alternatives.length < MAX_SUGGESTIONS) {
        alternatives.push(candidate);
      }
    }
    return [...preferred, ...alternatives].slice(0, MAX_SUGGESTIONS);
  }, [catalog, step.keyword, step.text]);
  const hasSuggestions = open && matches.length > 0;
  const isNew = catalog !== null && step.text.trim().length > 0 && matches.length === 0;

  return <div className="scenario-bdd-editor__text"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && hasSuggestions) {
        field.current?.focus();
        setOpen(false);
      }
    }}>
    <textarea ref={field} aria-label={'Texto del paso ' + number} rows={2} required
      className={isNew ? 'scenario-bdd-editor__text--new' : undefined}
      aria-describedby={isNew ? id + '-new' : undefined}
      aria-controls={hasSuggestions ? id : undefined} aria-autocomplete="list"
      value={step.text} onFocus={() => setOpen(true)}
      onChange={event => { onChange({ ...step, text: event.target.value }); setOpen(true); }}
      placeholder="Describe el paso" maxLength={MAX_ACTION_LENGTH - step.keyword.length - 1} />
    {isNew && <small id={id + '-new'} role="status">Paso nuevo · Sin coincidencias</small>}
    {hasSuggestions && <div className="scenario-bdd-editor__suggestions" id={id} role="group" aria-label="Pasos sugeridos">
      {matches.map(candidate => <button type="button" className="secondary" key={candidate.index}
        onMouseDown={event => event.preventDefault()} onClick={() => {
          onChange(candidate.step);
          field.current?.focus();
          setOpen(false);
        }}>
        <strong>{candidate.step.keyword}</strong> {candidate.step.text}
        <small>{candidate.title}</small>
      </button>)}
    </div>}
  </div>;
}

export function ScenarioStepsEditor({ steps, scenarios, onChange, disabled = false, reorderable = false }: {
  steps: DraftStep[];
  scenarios: ReadonlyArray<ScenarioStepSource> | null;
  onChange: (steps: DraftStep[]) => void;
  disabled?: boolean;
  reorderable?: boolean;
}) {
  const catalog = useMemo(() => scenarios ? buildStepCatalog(scenarios) : null, [scenarios]);

  function update(index: number, next: DraftStep) {
    onChange(steps.map((step, position) => position === index ? next : step));
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...steps];
    const target = index + offset;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return <fieldset className="scenario-bdd-editor" disabled={disabled}>
    <legend>Pasos del escenario</legend>
    {catalog === null && !disabled && <p className="muted">No se pudieron cargar los pasos sugeridos.</p>}
    <ol>
      {steps.map((step, index) => <li key={index}>
        <select aria-label={'Palabra clave del paso ' + (index + 1)} value={step.keyword}
          onChange={event => update(index, { ...step, keyword: event.target.value as GherkinKeyword })}>
          {GHERKIN_KEYWORDS.map(keyword => <option key={keyword}>{keyword}</option>)}
        </select>
        <StepTextField step={step} number={index + 1} catalog={catalog} onChange={next => update(index, next)} />
        <div className="scenario-bdd-editor__actions">
          {reorderable && <>
            <button type="button" className="secondary" onClick={() => move(index, -1)} disabled={index === 0} aria-label={'Subir paso ' + (index + 1)}>↑</button>
            <button type="button" className="secondary" onClick={() => move(index, 1)} disabled={index === steps.length - 1} aria-label={'Bajar paso ' + (index + 1)}>↓</button>
          </>}
          <button type="button" className="secondary" aria-label={'Quitar paso ' + (index + 1)} disabled={steps.length === 1}
            onClick={() => onChange(steps.filter((_, position) => position !== index))}>×</button>
        </div>
      </li>)}
    </ol>
    <button type="button" className="secondary" disabled={steps.length >= MAX_STEPS}
      onClick={() => onChange([...steps, { keyword: steps.length ? 'Y' : 'Dado', text: '' }])}>Agregar paso</button>
  </fieldset>;
}

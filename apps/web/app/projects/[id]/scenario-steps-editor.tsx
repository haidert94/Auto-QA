'use client';

import type { ScenarioStep } from './scenario-card';
import { GHERKIN_KEYWORDS, gherkinKeyword, scenarioStepText, type GherkinKeyword } from './scenario-presentation';

const MAX_STEPS = 50;
const MAX_ACTION_LENGTH = 1000;

type StepText = { keyword: GherkinKeyword; text: string };
type DraftStep = StepText & { original?: StepText & { step: ScenarioStep } };

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

export function ScenarioStepsEditor({ steps, onChange, disabled = false, reorderable = false }: {
  steps: DraftStep[];
  onChange: (steps: DraftStep[]) => void;
  disabled?: boolean;
  reorderable?: boolean;
}) {
  function update(index: number, patch: Partial<StepText>) {
    onChange(steps.map((step, position) => position === index ? { ...step, ...patch } : step));
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...steps];
    const target = index + offset;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return <fieldset className="scenario-bdd-editor" disabled={disabled}>
    <legend>Pasos del escenario</legend>
    <ol>
      {steps.map((step, index) => <li key={index}>
        <select aria-label={'Palabra clave del paso ' + (index + 1)} value={step.keyword}
          onChange={event => update(index, { keyword: event.target.value as GherkinKeyword })}>
          {GHERKIN_KEYWORDS.map(keyword => <option key={keyword}>{keyword}</option>)}
        </select>
        <textarea aria-label={'Texto del paso ' + (index + 1)} rows={2} required
          value={step.text} onChange={event => update(index, { text: event.target.value })}
          placeholder="Describe el paso" maxLength={MAX_ACTION_LENGTH - step.keyword.length - 1} />
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

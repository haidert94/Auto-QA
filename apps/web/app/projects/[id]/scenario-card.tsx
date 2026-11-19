'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { OrgRole } from '../../autoqa-server';
import { can } from '../../permissions';
import { gherkinKeyword, isSensitiveScenarioStep, scenarioStepText } from './scenario-presentation';

export type ScenarioStep = { ordinal: number; action: string; data?: string | null; expected?: string | null };

export type ScenarioListItem = {
  id: string;
  title: string;
  requirementId: string | null;
  expectedResult: string | null;
  steps: ScenarioStep[] | null;
  tags?: string[];
  playwright?: { automationId: string; filename: string } | null;
  requirement?: { title: string; externalKey: string | null } | null;
  _count?: { results: number };
};

// Tags reservados del flujo del caso. Son mutuamente excluyentes: un escenario
// representa flujo básico o alterno, no ambos a la vez.
const FLOW_TAGS = ['@flujoBasico', '@flujoAlterno'] as const;

export function ScenarioCard({ projectId, scenario, onChange, initialEditing = false, onEditComplete, role }: {
  projectId: string;
  scenario: ScenarioListItem;
  onChange: (updated: ScenarioListItem) => void;
  initialEditing?: boolean;
  onEditComplete?: () => void;
  role?: OrgRole;
}) {
  const canEdit = can(role, 'scenario.update');
  const [editing, setEditing] = useState(initialEditing && canEdit);
  const [title, setTitle] = useState(scenario.title);
  const [expectedResult, setExpectedResult] = useState(scenario.expectedResult ?? '');
  const [tags, setTags] = useState<string[]>(scenario.tags ?? []);
  const [customTag, setCustomTag] = useState('');
  const [steps, setSteps] = useState<ScenarioStep[]>(scenario.steps ?? []);
  const [showTechnicalSteps, setShowTechnicalSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setTitle(scenario.title);
    setExpectedResult(scenario.expectedResult ?? '');
    setTags(scenario.tags ?? []);
    setCustomTag('');
    setSteps(scenario.steps ?? []);
    setShowTechnicalSteps(false);
    setError('');
  }

  function cancel() {
    reset();
    setEditing(false);
    onEditComplete?.();
  }

  function toggleFlowTag(tag: typeof FLOW_TAGS[number]) {
    setTags(previous => {
      const withoutFlow = previous.filter(t => !(FLOW_TAGS as readonly string[]).includes(t));
      return previous.includes(tag) ? withoutFlow : [...withoutFlow, tag];
    });
  }

  function addCustomTag() {
    const raw = customTag.trim();
    if (!raw) return;
    const normalized = raw.startsWith('@') ? raw : '@' + raw;
    if (!/^@[A-Za-z0-9_-]{1,60}$/.test(normalized)) {
      setError(`"${normalized}" no es un tag válido. Usa @ seguido de letras, números, guiones o guión bajo.`);
      return;
    }
    if (tags.includes(normalized)) { setCustomTag(''); return; }
    setTags([...tags, normalized]);
    setCustomTag('');
    setError('');
  }

  function removeTag(tag: string) {
    setTags(previous => previous.filter(t => t !== tag));
  }

  function updateStep(index: number, patch: Partial<ScenarioStep>) {
    setSteps(previous => previous.map((s, i) => i === index ? { ...s, ...patch } : s));
  }

  function addStep() {
    setSteps(previous => [...previous, { ordinal: previous.length + 1, action: '', data: '', expected: '' }]);
    setShowTechnicalSteps(true);
  }

  function removeStep(index: number) {
    setSteps(previous => previous.filter((_, i) => i !== index).map((s, i) => ({ ...s, ordinal: i + 1 })));
  }

  async function save() {
    setError('');
    if (!title.trim()) { setError('El título no puede estar vacío.'); return; }
    if (steps.length === 0) { setError('El escenario necesita al menos un paso.'); return; }
    if (steps.some(s => !s.action.trim())) { setError('Todos los pasos deben tener una acción.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios/${scenario.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          expectedResult: expectedResult.trim() || null,
          tags,
          steps: steps.map((s, i) => ({
            ordinal: i + 1,
            action: s.action.trim(),
            data: s.data?.trim() || undefined,
            expected: s.expected?.trim() || undefined,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(Array.isArray(payload.message) ? payload.message.join(' · ') : (payload.message ?? 'No se pudo guardar.'));
        return;
      }
      onChange({ ...scenario, ...payload, tags: payload.tags ?? tags, steps: payload.steps ?? steps });
      setEditing(false);
      onEditComplete?.();
    } catch { setError('No se pudo comunicar con la API.'); }
    finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <li className="scenario-card">
        <header className="scenario-card__head">
          <div style={{ flex: 1 }}>
            <h3><Link href={`/projects/${projectId}/scenarios/${scenario.id}`}>{scenario.title}</Link></h3>
            <p className="muted">
              <small>ID <code>{scenario.id.slice(0, 8)}</code></small>
              {scenario.requirement && <> · <small>Requisito{scenario.requirement.externalKey
                ? ` [${scenario.requirement.externalKey}]`
                : ''}: {scenario.requirement.title}</small></>}
              {scenario._count && scenario._count.results > 0 && <> · <small>{scenario._count.results} resultado(s)</small></>}
            </p>
          </div>
          {canEdit && <button type="button" className="secondary" onClick={() => setEditing(true)}>Editar</button>}
        </header>

        {scenario.tags && scenario.tags.length > 0 && (
          <p className="scenario-card__tags">
            {scenario.tags.map(t => <span key={t} className={`tag ${(FLOW_TAGS as readonly string[]).includes(t) ? 'tag-flow' : ''}`}>{t}</span>)}
          </p>
        )}

        {scenario.expectedResult && <p className="scenario-card__expected"><small>
          <strong>Resultado esperado:</strong> {scenario.expectedResult}
        </small></p>}

        {Array.isArray(scenario.steps) && scenario.steps.length > 0 && <ol className="gherkin-steps">
          {scenario.steps.map((step, i) => {
            const keyword = gherkinKeyword(step, scenario.steps?.[i - 1]);
            return <li key={i}>
              <span className="gherkin-keyword">{keyword}</span>{' '}
              <span>{step.action}</span>
              {step.data && <span className="muted"> · <small>dato: {step.data}</small></span>}
              {step.expected && <span className="muted"> · <small>esperado: {step.expected}</small></span>}
            </li>;
          })}
        </ol>}
      </li>
    );
  }

  return (
    <li className="scenario-card scenario-card--editing">
      <header className="scenario-card__head">
        <strong>Editando · ID <code>{scenario.id.slice(0, 8)}</code></strong>
      </header>

      <label className="scenario-edit-field">
        <span>Título</span>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={300} required/>
      </label>

      <fieldset className="scenario-edit-tags">
        <legend>Tags</legend>
        <div className="scenario-edit-tags__flow">
          {FLOW_TAGS.map(t => (
            <label key={t} className="check">
              <input type="checkbox" checked={tags.includes(t)} onChange={() => toggleFlowTag(t)}/>
              <span>{t}</span>
            </label>
          ))}
        </div>
        <div className="scenario-edit-tags__chips">
          {tags.filter(t => !(FLOW_TAGS as readonly string[]).includes(t)).map(t => (
            <span key={t} className="tag">
              {t}{' '}
              <button type="button" aria-label={`Quitar ${t}`} onClick={() => removeTag(t)}>×</button>
            </span>
          ))}
          <input value={customTag} placeholder="@tagCustom" maxLength={61}
            onChange={e => setCustomTag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }}/>
          <button type="button" className="secondary" onClick={addCustomTag}>Agregar tag</button>
        </div>
      </fieldset>

      <label className="scenario-edit-field">
        <span>Resultado esperado</span>
        <textarea value={expectedResult} onChange={e => setExpectedResult(e.target.value)} maxLength={2000} rows={2}/>
      </label>

      <fieldset>
        <legend>Pasos</legend>
        <ol className="scenario-edit-steps">
          {steps.map((step, index) => (
            <li key={index}>
              <div className="scenario-edit-step__row">
                {showTechnicalSteps ? <input value={step.action} placeholder="Acción (goto:/click:/fill:/expect:…)" maxLength={1000}
                  onChange={e => updateStep(index, { action: e.target.value })}/> : <span>{scenarioStepText(step) || 'Paso sin acción'}</span>}
                <button type="button" className="secondary" onClick={() => removeStep(index)}
                  aria-label={`Quitar paso ${index + 1}`}>×</button>
              </div>
              {showTechnicalSteps ? <div className="scenario-edit-step__row">
                <input type={isSensitiveScenarioStep(step) ? 'password' : 'text'} value={step.data ?? ''} placeholder="Dato (opcional)" maxLength={1000}
                  onChange={e => updateStep(index, { data: e.target.value })}/>
                <input value={step.expected ?? ''} placeholder="Esperado (opcional)" maxLength={1000}
                  onChange={e => updateStep(index, { expected: e.target.value })}/>
              </div> : step.expected && <small className="muted">Resultado esperado · {step.expected}</small>}
            </li>
          ))}
        </ol>
        <div className="actions">
          <button type="button" className="secondary" onClick={addStep}>Agregar paso</button>
          {steps.length > 0 && <button type="button" className="secondary" aria-expanded={showTechnicalSteps}
            onClick={() => setShowTechnicalSteps(value => !value)}>
            {showTechnicalSteps ? 'Ver en lenguaje natural' : 'Editar pasos técnicos'}
          </button>}
        </div>
      </fieldset>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="actions">
        <button type="button" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="secondary" onClick={cancel} disabled={busy}>Cancelar</button>
      </div>
    </li>
  );
}

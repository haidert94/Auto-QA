'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { OrgRole } from '../../../../autoqa-server';
import { can } from '../../../../permissions';
import { isManualScenario, MANUAL_SCENARIO_MESSAGE } from '../../scenario-presentation';

export type ScenarioStep = { ordinal: number; action: string; data?: string; expected?: string };

export type Scenario = {
  id: string;
  projectId: string;
  title: string;
  requirementId: string | null;
  expectedResult: string | null;
  steps: ScenarioStep[];
  tags?: string[];
  requirement: { id: string; title: string; externalKey: string | null } | null;
};

export type RequirementOption = { id: string; title: string; externalKey: string | null };

export function ScenarioEditor({ initial, requirements, role }: { initial: Scenario; requirements: RequirementOption[]; role?: OrgRole }) {
  const router = useRouter();
  const canEdit = can(role, 'scenario.update');
  const canDelete = can(role, 'scenario.delete');
  const [title, setTitle] = useState(initial.title);
  const [requirementId, setRequirementId] = useState(initial.requirementId ?? '');
  const [expectedResult, setExpectedResult] = useState(initial.expectedResult ?? '');
  const [steps, setSteps] = useState<ScenarioStep[]>(
    initial.steps.length ? initial.steps : [{ ordinal: 1, action: '' }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playwrightCode, setPlaywrightCode] = useState<{ filename: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadPlaywright() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${initial.projectId}/scenarios/${initial.id}/playwright`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo generar el código.'); return; }
      setPlaywrightCode(payload);
      setCopied(false);
    } catch { setError('No se pudo generar el código.'); }
    finally { setBusy(false); }
  }

  async function copyCode() {
    if (!playwrightCode) return;
    try {
      await navigator.clipboard.writeText(playwrightCode.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError('No se pudo copiar al portapapeles.'); }
  }

  function updateStep(index: number, patch: Partial<ScenarioStep>) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
  }

  function addStep() {
    setSteps(prev => prev.length >= 50 ? prev : [...prev, { ordinal: prev.length + 1, action: '' }]);
  }

  function removeStep(index: number) {
    setSteps(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, ordinal: i + 1 })));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((s, i) => ({ ...s, ordinal: i + 1 }));
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/projects/${initial.projectId}/scenarios/${initial.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          requirementId: requirementId || null,
          expectedResult: expectedResult.trim() || null,
          steps: steps.map((s, i) => ({
            ordinal: i + 1,
            action: s.action.trim(),
            data: s.data?.trim() || undefined,
            expected: s.expected?.trim() || undefined,
          })).filter(s => s.action.length > 0),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo guardar el escenario.'); return; }
      setNotice('Escenario guardado.');
      router.refresh();
    } catch { setError('No se pudo guardar el escenario.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('¿Quitar este escenario de la lista? Sus ejecuciones seguirán en el historial.')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${initial.projectId}/scenarios/${initial.id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.message ?? 'No se pudo eliminar el escenario.');
        return;
      }
      router.push(`/projects/${initial.projectId}#escenarios`);
      router.refresh();
    } catch { setError('No se pudo eliminar el escenario.'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} className="scenario-editor">
    <label>Título
      <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={300}/>
    </label>

    <label>Requisito asociado
      <select value={requirementId} onChange={e => setRequirementId(e.target.value)}>
        <option value="">— Sin requisito —</option>
        {requirements.map(r => <option key={r.id} value={r.id}>
          {r.externalKey ? `[${r.externalKey}] ` : ''}{r.title}
        </option>)}
      </select>
    </label>

    <label>Resultado esperado
      <textarea value={expectedResult} onChange={e => setExpectedResult(e.target.value)} rows={3} maxLength={2000}/>
    </label>

    <fieldset>
      <legend>Pasos ({steps.length}/50)</legend>
      <ol className="scenario-steps">
        {steps.map((step, index) => <li key={index}>
          <div className="step-row">
            <span className="step-ordinal">#{index + 1}</span>
            <div className="step-fields">
              <input placeholder="Acción" value={step.action} onChange={e => updateStep(index, { action: e.target.value })} required maxLength={1000}/>
              <input placeholder="Dato (opcional)" value={step.data ?? ''} onChange={e => updateStep(index, { data: e.target.value })} maxLength={1000}/>
              <input placeholder="Esperado (opcional)" value={step.expected ?? ''} onChange={e => updateStep(index, { expected: e.target.value })} maxLength={1000}/>
            </div>
            <div className="step-actions">
              <button type="button" className="secondary" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="Subir">↑</button>
              <button type="button" className="secondary" onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1} aria-label="Bajar">↓</button>
              <button type="button" className="secondary" onClick={() => removeStep(index)} disabled={steps.length === 1} aria-label="Eliminar paso">✕</button>
            </div>
          </div>
        </li>)}
      </ol>
      <button type="button" className="secondary" onClick={addStep} disabled={steps.length >= 50}>Añadir paso</button>
    </fieldset>

    <div className="actions">
      {canEdit && <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>}
      {isManualScenario(initial) ? <p>{MANUAL_SCENARIO_MESSAGE}</p> :
        <button type="button" className="secondary" onClick={loadPlaywright} disabled={busy}>Ver código Playwright</button>}
      {canDelete && <button type="button" className="secondary" onClick={remove} disabled={busy}>Eliminar escenario</button>}
    </div>

    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {playwrightCode && <section className="playwright-preview">
      <header>
        <strong>{playwrightCode.filename}</strong>
        <div className="actions">
          <button type="button" className="secondary" onClick={copyCode}>
            {copied ? 'Copiado' : 'Copiar al portapapeles'}
          </button>
          <button type="button" className="secondary" onClick={() => setPlaywrightCode(null)}>Cerrar</button>
        </div>
      </header>
      <p className="muted">
        Vocabulario reconocido: <code>navigate:</code>, <code>click:</code>, <code>fill:</code>, <code>press:</code>,
        <code> expect-text:</code>, <code>expect-url:</code>. Los pasos fuera del vocabulario salen como <code>// TODO</code>.
      </p>
      <pre><code>{playwrightCode.code}</code></pre>
    </section>}
  </form>;
}

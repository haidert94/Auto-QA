'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { OrgRole } from '../../../../autoqa-server';
import { can } from '../../../../permissions';
import { isManualScenario, MANUAL_SCENARIO_MESSAGE } from '../../scenario-presentation';

import type { ScenarioStep } from '../../scenario-card';
import { saveScenarioSteps, scenarioStepDrafts, ScenarioStepsEditor, type ScenarioStepSource } from '../../scenario-steps-editor';

export type Scenario = {
  id: string;
  projectId: string;
  title: string;
  requirementId: string | null;
  expectedResult: string | null;
  steps: ScenarioStep[];
  tags?: string[];
  requirementReviewRequiredAt?: string | null;
  requirement: { id: string; title: string; externalKey: string | null; criteria?: Array<{ text: string }> } | null;
};

export type RequirementOption = { id: string; title: string; externalKey: string | null };

export function ScenarioEditor({ initial, requirements, scenarios, role }: {
  initial: Scenario;
  requirements: RequirementOption[];
  scenarios: ScenarioStepSource[] | null;
  role?: OrgRole;
}) {
  const router = useRouter();
  const canEdit = can(role, 'scenario.update');
  const canDelete = can(role, 'scenario.delete');
  const [title, setTitle] = useState(initial.title);
  const [requirementId, setRequirementId] = useState(initial.requirementId ?? '');
  const [expectedResult, setExpectedResult] = useState(initial.expectedResult ?? '');
  const [steps, setSteps] = useState(() => scenarioStepDrafts(initial.steps));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewedAt, setReviewedAt] = useState<string>();
  const [notice, setNotice] = useState('');
  const [playwrightCode, setPlaywrightCode] = useState<{ filename: string; code: string; sharedStepsFilename?: string | null } | null>(null);
  const [sharedCode, setSharedCode] = useState<{ filename: string; code: string } | null>(null);
  const [showShared, setShowShared] = useState(false);
  const activeCode = showShared ? sharedCode : playwrightCode;
  const [copied, setCopied] = useState(false);

  async function loadPlaywright() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${initial.projectId}/scenarios/${initial.id}/playwright`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo generar el código.'); return; }
      setPlaywrightCode(payload);
      setSharedCode(null);
      setShowShared(false);
      setCopied(false);
    } catch { setError('No se pudo generar el código.'); }
    finally { setBusy(false); }
  }

  async function toggleSharedCode() {
    setCopied(false);
    if (showShared || sharedCode) { setShowShared(!showShared); return; }
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${initial.projectId}/scenarios/playwright-steps`, { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      if (typeof payload.filename !== 'string' || typeof payload.code !== 'string') throw new Error();
      setSharedCode(payload);
      setShowShared(true);
    } catch { setError('No se pudieron cargar los pasos compartidos.'); }
    finally { setBusy(false); }
  }

  async function copyCode() {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError('No se pudo copiar al portapapeles.'); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice('');
    const stepPayload = saveScenarioSteps(steps);
    if (!stepPayload.steps) { setError(stepPayload.error); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${initial.projectId}/scenarios/${initial.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          requirementId: requirementId || null,
          expectedResult: expectedResult.trim() || null,
          steps: stepPayload.steps,
          reviewedRequirementAt: reviewedAt,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo guardar el escenario.'); return; }
      setSteps(scenarioStepDrafts(payload.steps ?? stepPayload.steps));
      setPlaywrightCode(null);
      setReviewedAt(undefined);
      setNotice('Escenario guardado.');
      router.refresh();
    } catch { setError('No se pudo guardar el escenario.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('¿Eliminar este escenario y sus ejecuciones de forma definitiva?')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${initial.projectId}/scenarios/delete-selected`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioIds: [initial.id] }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message;
        setError(message || 'No se pudo eliminar el escenario.');
        return;
      }
      router.push(`/projects/${initial.projectId}#escenarios`);
      router.refresh();
    } catch { setError('No se pudo eliminar el escenario.'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} className="scenario-editor">
    {initial.requirementReviewRequiredAt && <fieldset>
      <legend>Revisión por aclaración del requisito</legend>
      <p>{initial.requirement?.title}</p>
      {!!initial.requirement?.criteria?.length && <ul>
        {initial.requirement.criteria.map((criterion, index) => <li key={index}>{criterion.text}</li>)}
      </ul>}
      {canEdit && <label className="actions">
        <input type="checkbox" checked={reviewedAt === initial.requirementReviewRequiredAt}
          onChange={event => setReviewedAt(event.target.checked ? initial.requirementReviewRequiredAt ?? undefined : undefined)} />
        Confirmo que el escenario cubre el requisito aclarado.
      </label>}
    </fieldset>}
    <label>Título
      <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={300}/>
    </label>

    <label>Historia o requisito asociado
      <select value={requirementId} required onChange={e => setRequirementId(e.target.value)}>
        <option value="">Selecciona una historia o requisito</option>
        {requirements.map(r => <option key={r.id} value={r.id}>
          {r.externalKey ? `[${r.externalKey}] ` : ''}{r.title}
        </option>)}
      </select>
    </label>

    <label>Resultado esperado
      <textarea value={expectedResult} onChange={e => setExpectedResult(e.target.value)} rows={3} maxLength={2000}/>
    </label>

    <ScenarioStepsEditor steps={steps} scenarios={scenarios} onChange={setSteps} disabled={!canEdit || busy} reorderable />

    <div className="actions">
      {canEdit && <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>}
      {isManualScenario(initial) ? <p>{MANUAL_SCENARIO_MESSAGE}</p> :
        <button type="button" className="secondary" onClick={loadPlaywright} disabled={busy}>Ver código Playwright</button>}
      {canDelete && <button type="button" className="secondary" onClick={remove} disabled={busy}>Eliminar escenario</button>}
    </div>

    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {playwrightCode && activeCode && <section className="playwright-preview">
      <header>
        <strong>{activeCode.filename}</strong>
        <div className="actions">
          {playwrightCode.sharedStepsFilename && <button type="button" className="secondary" disabled={busy} onClick={toggleSharedCode}>
            {showShared ? 'Ver escenario' : 'Ver pasos compartidos'}
          </button>}
          <button type="button" className="secondary" onClick={copyCode}>
            {copied ? 'Copiado' : 'Copiar al portapapeles'}
          </button>
          <button type="button" className="secondary" onClick={() => setPlaywrightCode(null)}>Cerrar</button>
        </div>
      </header>
      {playwrightCode.sharedStepsFilename && <p className="muted">
        Guarda <code>{playwrightCode.sharedStepsFilename}</code> una sola vez en la carpeta de los archivos Playwright del proyecto.
      </p>}
      <pre><code>{activeCode.code}</code></pre>
    </section>}
  </form>;
}

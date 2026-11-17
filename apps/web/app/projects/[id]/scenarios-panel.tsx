'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

type ScenarioListItem = {
  id: string;
  title: string;
  requirementId: string | null;
  expectedResult: string | null;
  _count?: { results: number };
};

type RequirementOption = { id: string; title: string; externalKey: string | null };

export function ScenariosPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ScenarioListItem[] | null>(null);
  const [requirements, setRequirements] = useState<RequirementOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [requirementId, setRequirementId] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [firstAction, setFirstAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ title: string; expectedResult?: string; steps: Array<{ action: string; data?: string; expected?: string }> }> | null>(null);
  const [suggestionMeta, setSuggestionMeta] = useState<{ model: string; usedFallback: boolean } | null>(null);

  async function suggest() {
    if (!requirementId) { setError('Selecciona primero un requisito para sugerir escenarios.'); return; }
    setSuggesting(true); setError(''); setSuggestions(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios/suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirementId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo generar sugerencias.'); return; }
      setSuggestions(Array.isArray(payload.scenarios) ? payload.scenarios : []);
      setSuggestionMeta({ model: payload.model ?? 'rule-based', usedFallback: !!payload.usedFallback });
    } catch { setError('No se pudo generar sugerencias.'); }
    finally { setSuggesting(false); }
  }

  async function createFromSuggestion(suggestion: { title: string; expectedResult?: string; steps: Array<{ action: string; data?: string; expected?: string }> }) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: suggestion.title.trim(),
          requirementId: requirementId || undefined,
          expectedResult: suggestion.expectedResult?.trim() || undefined,
          steps: suggestion.steps.map((s, i) => ({ ordinal: i + 1, action: s.action, data: s.data, expected: s.expected })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo crear el escenario sugerido.'); return; }
      setSuggestions(prev => prev?.filter(s => s !== suggestion) ?? null);
      await load();
    } catch { setError('No se pudo crear el escenario sugerido.'); }
    finally { setBusy(false); }
  }

  async function load() {
    try {
      const [listRes, reqRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/scenarios`, { cache: 'no-store' }),
        fetch(`/api/projects/${projectId}/scenarios/requirements`, { cache: 'no-store' }),
      ]);
      if (listRes.ok) setItems(await listRes.json());
      else { setError('No se pudo cargar el listado.'); setItems([]); }
      if (reqRes.ok) setRequirements(await reqRes.json());
    } catch { setError('No se pudo cargar el listado.'); setItems([]); }
  }

  useEffect(() => { void load(); }, [projectId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          requirementId: requirementId || undefined,
          expectedResult: expectedResult.trim() || undefined,
          steps: [{ ordinal: 1, action: firstAction.trim() || 'Describe el primer paso' }],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo crear el escenario.'); return; }
      setTitle(''); setRequirementId(''); setExpectedResult(''); setFirstAction('');
      setShowForm(false);
      await load();
    } catch { setError('No se pudo crear el escenario.'); }
    finally { setBusy(false); }
  }

  return <section className="exploration-panel">
    <h2>Escenarios</h2>
    <p className="muted">
      Define los escenarios de prueba manualmente. La generación a Playwright y la ejecución llegan en las fases siguientes.
    </p>

    <div className="actions">
      <button type="button" onClick={() => setShowForm(s => !s)}>
        {showForm ? 'Cancelar' : 'Nuevo escenario'}
      </button>
      <button type="button" className="secondary" onClick={suggest} disabled={suggesting || !requirementId}>
        {suggesting ? 'Pensando…' : 'Sugerir con IA'}
      </button>
    </div>

    {suggestions && <section className="ai-suggestions">
      <header>
        <strong>Propuesta IA ({suggestions.length})</strong>
        <span className="muted">{suggestionMeta?.model}{suggestionMeta?.usedFallback ? ' · fallback (plan sin IA)' : ''}</span>
        <button type="button" className="secondary" onClick={() => setSuggestions(null)}>Descartar todas</button>
      </header>
      {suggestions.length === 0
        ? <p className="muted">La IA no devolvió sugerencias utilizables para este requisito.</p>
        : <ul className="ai-suggestions-list">
          {suggestions.map((s, i) => <li key={i}>
            <div className="suggestion-head">
              <strong>{s.title}</strong>
              <button type="button" onClick={() => createFromSuggestion(s)} disabled={busy}>Crear este</button>
            </div>
            {s.expectedResult && <p className="muted">Esperado: {s.expectedResult}</p>}
            <ol className="suggestion-steps">
              {s.steps.map((step, j) => <li key={j}>
                <code>{step.action}</code>
                {step.data && <span className="muted"> · dato: {step.data}</span>}
              </li>)}
            </ol>
          </li>)}
        </ul>}
    </section>}

    {showForm && <form onSubmit={create} className="scenario-form">
      <label>Título
        <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={300} placeholder="Login con credenciales válidas"/>
      </label>
      <label>Requisito asociado (opcional)
        <select value={requirementId} onChange={e => setRequirementId(e.target.value)}>
          <option value="">— Sin requisito —</option>
          {requirements.map(r => <option key={r.id} value={r.id}>
            {r.externalKey ? `[${r.externalKey}] ` : ''}{r.title}
          </option>)}
        </select>
      </label>
      <label>Resultado esperado (opcional)
        <textarea value={expectedResult} onChange={e => setExpectedResult(e.target.value)} maxLength={2000} rows={2}
                  placeholder="El sistema redirige al dashboard del usuario."/>
      </label>
      <label>Primer paso
        <input value={firstAction} onChange={e => setFirstAction(e.target.value)} maxLength={1000}
               placeholder="Abrir la página de login"/>
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear escenario'}</button>
    </form>}

    {error && <p className="error" role="alert">{error}</p>}

    {items === null
      ? <p className="muted">Cargando…</p>
      : items.length === 0
        ? <p className="muted">Aún no hay escenarios en este proyecto.</p>
        : <ul className="scenario-list">
          {items.map(item => <li key={item.id}>
            <Link href={`/projects/${projectId}/scenarios/${item.id}`}>
              <span className="scenario-title">{item.title}</span>
              {item.requirementId && <span className="badge">Con requisito</span>}
              {item._count && item._count.results > 0 && <span className="muted">{item._count.results} resultado(s)</span>}
            </Link>
          </li>)}
        </ul>}
  </section>;
}

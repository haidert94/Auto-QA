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
    </div>

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

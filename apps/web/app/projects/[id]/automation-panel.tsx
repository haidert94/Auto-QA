'use client';

import { useEffect, useState } from 'react';

type Scenario = {
  id: string;
  title: string;
  requirementId: string | null;
  expectedResult: string | null;
};

type GeneratedSpec = {
  scenarioId: string;
  title: string;
  spec: string;
  error?: string;
};

export function AutomationPanel({ projectId }: { projectId: string }) {
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [specs, setSpecs] = useState<GeneratedSpec[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/scenarios`, { cache: 'no-store' });
        if (!active) return;
        if (!response.ok) {
          setError('No se pudo cargar la lista de escenarios.');
          setScenarios([]);
          return;
        }
        const list: Scenario[] = await response.json();
        setScenarios(list);
        // Preseleccionamos todos para que el botón funcione al primer click.
        setSelected(new Set(list.map(s => s.id)));
      } catch {
        if (active) { setError('No se pudo comunicar con la API.'); setScenarios([]); }
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(previous => previous.size === scenarios?.length
      ? new Set()
      : new Set(scenarios?.map(s => s.id) ?? []));
  }

  async function generate() {
    setError('');
    if (selected.size === 0) { setError('Selecciona al menos un escenario.'); return; }
    setBusy(true); setSpecs(null);
    try {
      const results: GeneratedSpec[] = [];
      for (const id of selected) {
        const scenario = scenarios?.find(s => s.id === id);
        if (!scenario) continue;
        try {
          const response = await fetch(`/api/projects/${projectId}/scenarios/${id}/playwright`, { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            results.push({ scenarioId: id, title: scenario.title, spec: '', error: payload.message ?? 'Error' });
          } else {
            results.push({ scenarioId: id, title: scenario.title, spec: payload.spec ?? '' });
          }
        } catch {
          results.push({ scenarioId: id, title: scenario.title, spec: '', error: 'Falló la petición.' });
        }
      }
      setSpecs(results);
    } finally { setBusy(false); }
  }

  if (scenarios === null) {
    return <section className="panel"><p className="muted">Cargando escenarios…</p></section>;
  }

  if (scenarios.length === 0) {
    return (
      <section className="panel">
        <h2>Automatización</h2>
        <p className="muted">
          Todavía no hay escenarios que automatizar. Ve a la pestaña Escenarios y pulsa "Generar escenarios"
          primero, o crea uno manualmente.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <h2>Automatización</h2>
        <p className="muted">
          Selecciona los escenarios que quieres convertir a código Playwright ejecutable. El generador es
          determinístico (sin IA) y reconoce verbos como <code>goto:</code>, <code>click:</code>,
          <code>fill:</code>, <code>expect:</code> en los pasos. Lo que no reconoce queda como
          <code>// TODO</code> en el spec para que lo completes.
        </p>

        <div className="actions">
          <button type="button" onClick={generate} disabled={busy || selected.size === 0}>
            {busy ? 'Generando…' : `Crear automatización (${selected.size})`}
          </button>
          <button type="button" className="secondary" onClick={toggleAll}>
            {selected.size === scenarios.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
          </button>
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <ul className="scenario-pick">
          {scenarios.map(s => (
            <li key={s.id}>
              <label>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                <span>
                  <strong>{s.title}</strong>
                  <small className="muted"> · <code>{s.id.slice(0, 8)}</code></small>
                  {s.expectedResult && <p className="muted"><small>Esperado: {s.expectedResult}</small></p>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {specs && specs.length > 0 && (
        <section className="panel">
          <h2>Código generado ({specs.length})</h2>
          <p className="muted"><small>
            Copia estos specs al proyecto de Playwright (<code>tests/*.spec.ts</code>) para ejecutarlos
            con <code>npx playwright test</code>. Los <code>// TODO</code> marcan pasos que el generador
            no supo traducir y deben completarse a mano.
          </small></p>
          {specs.map(s => (
            <article key={s.scenarioId} className="spec-output">
              <header>
                <strong>{s.title}</strong>
                <small className="muted"> · <code>{s.scenarioId.slice(0, 8)}</code></small>
              </header>
              {s.error
                ? <p className="error" role="alert">{s.error}</p>
                : <pre><code>{s.spec}</code></pre>}
            </article>
          ))}
        </section>
      )}
    </>
  );
}

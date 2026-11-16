'use client';

import { useEffect, useState, type FormEvent } from 'react';

export type EnvironmentOption = { id: string; type: string | null; baseUrl: string | null };

type RunResult = {
  id: string;
  status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
  durationMs: number | null;
  errorMessage: string | null;
  evidenceKey: string | null;
};

type Run = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  environmentId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  createdAt: string;
  results: RunResult[];
};

type DiffPayload = {
  previous: { id: string; status: string; createdAt: string; completedAt: string | null } | null;
  current: { id: string; status: string; createdAt: string; completedAt: string | null };
  resultChanges: Array<{ scenarioId: string; from: string | null; to: string | null; durationFromMs: number | null; durationToMs: number | null }>;
  specDiff: { changed: boolean; previousLines: number; currentLines: number; addedLines: number; removedLines: number };
  specs: { previous: string | null; current: string | null };
};

const runStatusLabel: Record<Run['status'], string> = {
  QUEUED: 'En cola', RUNNING: 'En curso', COMPLETED: 'Completada', FAILED: 'Falló', CANCELED: 'Cancelada',
};

const resultLabel: Record<RunResult['status'], string> = {
  PASSED: 'Pasó', FAILED: 'Falló', BLOCKED: 'Bloqueada', SKIPPED: 'Omitida',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(ms: number | null) {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function RunsPanel({ projectId, scenarioId, environments }: { projectId: string; scenarioId: string; environments: EnvironmentOption[] }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [diff, setDiff] = useState<DiffPayload | null>(null);

  async function loadDiff(runId: string) {
    setDiff(null); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/runs/${runId}/diff`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) { setError('No se pudo cargar el diff.'); return; }
      setDiff(payload);
    } catch { setError('No se pudo cargar el diff.'); }
  }

  async function load() {
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios/${scenarioId}/runs`, { cache: 'no-store' });
      if (!response.ok) { setError('No se pudo cargar el historial de ejecuciones.'); return; }
      setRuns(await response.json());
    } catch { setError('No se pudo cargar el historial.'); }
  }

  useEffect(() => { void load(); }, [projectId, scenarioId]);

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/projects/${projectId}/scenarios/${scenarioId}/runs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentId: envId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo encolar la ejecución.'); return; }
      setNotice('Ejecución encolada.');
      await load();
    } catch { setError('No se pudo encolar la ejecución.'); }
    finally { setBusy(false); }
  }

  if (environments.length === 0) {
    return <section className="runs-panel">
      <h2>Ejecuciones</h2>
      <p className="muted">
        Registra al menos un entorno autorizado en modo solo lectura para ejecutar el escenario.
      </p>
    </section>;
  }

  return <section className="runs-panel">
    <h2>Ejecuciones</h2>
    <p className="muted">
      Corre el escenario contra un entorno autorizado. El worker genera el spec de Playwright con filtro
      de requests y guarda el trace.
    </p>

    <form onSubmit={queue} className="exploration-form">
      <label>Entorno<select value={envId} onChange={e => setEnvId(e.target.value)} required>
        {environments.map(env => <option key={env.id} value={env.id}>
          {env.type ?? 'Entorno'} · {env.baseUrl ?? env.id.slice(0, 8)}
        </option>)}
      </select></label>
      <div />
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Encolando…' : 'Ejecutar'}</button>
        <button type="button" className="secondary" onClick={load}>Actualizar</button>
      </div>
    </form>

    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {runs === null
      ? <p className="muted">Cargando…</p>
      : runs.length === 0
        ? <p className="muted">Sin ejecuciones aún.</p>
        : <ul className="runs-list">
          {runs.map(run => <li key={run.id}>
            <div className="run-head">
              <span className={`badge badge-${run.status.toLowerCase()}`}>{runStatusLabel[run.status]}</span>
              <span className="muted">{formatDate(run.createdAt)}</span>
              {run.errorCode && <span className="muted">· {run.errorCode}</span>}
              {(run.status === 'COMPLETED' || run.status === 'FAILED') && <button type="button" className="secondary"
                onClick={() => loadDiff(run.id)}>Comparar con anterior</button>}
            </div>
            {run.results.length > 0 && <ul className="results-list">
              {run.results.map(result => <li key={result.id}>
                <span className={`badge badge-result-${result.status.toLowerCase()}`}>{resultLabel[result.status]}</span>
                <span className="muted">{formatDuration(result.durationMs)}</span>
                {result.errorMessage && <span className="result-error">{result.errorMessage}</span>}
                {result.evidenceKey && <a href={`/api/projects/${projectId}/runs/${run.id}/trace/${result.id}`} target="_blank" rel="noopener">
                  Descargar trace
                </a>}
              </li>)}
            </ul>}
          </li>)}
        </ul>}

    {diff && <section className="diff-panel">
      <header>
        <strong>Comparación</strong>
        <button type="button" className="secondary" onClick={() => setDiff(null)}>Cerrar</button>
      </header>
      {!diff.previous
        ? <p className="muted">No hay una ejecución anterior con la que comparar.</p>
        : <>
          <p className="muted">
            Actual {formatDate(diff.current.createdAt)} · Anterior {formatDate(diff.previous.createdAt)}
          </p>
          <h3>Cambios de resultado ({diff.resultChanges.length})</h3>
          {diff.resultChanges.length === 0
            ? <p className="muted">Sin cambios de estado ni duración.</p>
            : <ul className="results-list">
              {diff.resultChanges.map(c => <li key={c.scenarioId}>
                <span className={`badge badge-result-${(c.from ?? 'blocked').toLowerCase()}`}>{c.from ?? '—'}</span>
                <span>→</span>
                <span className={`badge badge-result-${(c.to ?? 'blocked').toLowerCase()}`}>{c.to ?? '—'}</span>
                {c.durationFromMs !== null && c.durationToMs !== null && <span className="muted">
                  {formatDuration(c.durationFromMs)} → {formatDuration(c.durationToMs)}
                </span>}
              </li>)}
            </ul>}
          <h3>Diff del spec</h3>
          <p className="muted">
            {diff.specDiff.changed
              ? `Cambió · +${diff.specDiff.addedLines} / -${diff.specDiff.removedLines} líneas.`
              : 'Spec idéntico.'}
          </p>
        </>}
    </section>}
  </section>;
}

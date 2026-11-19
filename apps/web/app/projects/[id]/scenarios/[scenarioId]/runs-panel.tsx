'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { OrgRole } from '../../../../autoqa-server';
import { can } from '../../../../permissions';

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
  targetBrowser: string | null;
  targetDevice: string | null;
  targetProvider: string | null;
  providerSessionUrl: string | null;
  results: RunResult[];
};

const PROVIDER_OPTIONS = [
  { value: 'LOCAL', label: 'Local · worker AutoQA' },
  { value: 'BROWSERSTACK', label: 'BrowserStack · dispositivos reales' },
] as const;

const BROWSER_OPTIONS = [
  { value: 'CHROMIUM', label: 'Chromium' },
  { value: 'FIREFOX', label: 'Firefox' },
  { value: 'WEBKIT', label: 'WebKit (Safari)' },
] as const;

const DEVICE_OPTIONS = [
  { value: '', label: 'Desktop' },
  { value: 'iPhone 13', label: 'iPhone 13' },
  { value: 'iPhone 14', label: 'iPhone 14' },
  { value: 'iPhone 15', label: 'iPhone 15' },
  { value: 'iPhone SE', label: 'iPhone SE' },
  { value: 'Pixel 5', label: 'Pixel 5' },
  { value: 'Pixel 7', label: 'Pixel 7' },
  { value: 'Galaxy S9+', label: 'Galaxy S9+' },
  { value: 'iPad (gen 7)', label: 'iPad' },
  { value: 'iPad Pro 11', label: 'iPad Pro' },
] as const;

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

export function RunsPanel({ projectId, scenarioId, environments, role, manual = false }: { projectId: string; scenarioId: string; environments: EnvironmentOption[]; role?: OrgRole; manual?: boolean }) {
  const canRun = !manual && can(role, 'run.execute');
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [targetBrowser, setTargetBrowser] = useState<'CHROMIUM' | 'FIREFOX' | 'WEBKIT'>('CHROMIUM');
  const [targetDevice, setTargetDevice] = useState('');
  const [targetProvider, setTargetProvider] = useState<'LOCAL' | 'BROWSERSTACK'>('LOCAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [diff, setDiff] = useState<DiffPayload | null>(null);
  const [explanation, setExplanation] = useState<{ runId: string; text: string; model: string; usedFallback: boolean } | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);

  async function explainRun(runId: string) {
    setExplaining(runId); setExplanation(null); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/runs/${runId}/explain`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) { setError(payload?.message ?? 'No se pudo generar la explicación.'); return; }
      setExplanation({ runId, text: payload.text ?? '', model: payload.model ?? '', usedFallback: !!payload.usedFallback });
    } catch { setError('No se pudo generar la explicación.'); }
    finally { setExplaining(null); }
  }

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
        body: JSON.stringify({
          environmentId: envId,
          targetBrowser,
          targetDevice: targetDevice || undefined,
          targetProvider,
        }),
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

    {canRun && <form onSubmit={queue} className="run-form">
      <label>Entorno<select value={envId} onChange={e => setEnvId(e.target.value)} required>
        {environments.map(env => <option key={env.id} value={env.id}>
          {env.type ?? 'Entorno'} · {env.baseUrl ?? env.id.slice(0, 8)}
        </option>)}
      </select></label>
      <label>Navegador<select value={targetBrowser} onChange={e => setTargetBrowser(e.target.value as typeof targetBrowser)}>
        {BROWSER_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
      </select></label>
      <label>Dispositivo<select value={targetDevice} onChange={e => setTargetDevice(e.target.value)}>
        {DEVICE_OPTIONS.map(d => <option key={d.value || 'desktop'} value={d.value}>{d.label}</option>)}
      </select></label>
      <label>Dónde se ejecuta<select value={targetProvider} onChange={e => setTargetProvider(e.target.value as typeof targetProvider)}>
        {PROVIDER_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select></label>
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Encolando…' : 'Ejecutar'}</button>
        <button type="button" className="secondary" onClick={load}>Actualizar</button>
      </div>
    </form>}

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
              <span className="muted">· {run.targetBrowser ?? 'CHROMIUM'}{run.targetDevice ? ' · ' + run.targetDevice : ''}{run.targetProvider && run.targetProvider !== 'LOCAL' ? ' · ' + run.targetProvider : ''}</span>
              {run.providerSessionUrl && <a href={run.providerSessionUrl} target="_blank" rel="noopener">Sesión remota ↗</a>}
              {run.errorCode && <span className="muted">· {run.errorCode}</span>}
              {(run.status === 'COMPLETED' || run.status === 'FAILED') && <button type="button" className="secondary"
                onClick={() => loadDiff(run.id)}>Comparar con anterior</button>}
              {run.status === 'FAILED' && <button type="button" className="secondary"
                onClick={() => explainRun(run.id)} disabled={explaining === run.id}>
                {explaining === run.id ? 'Explicando…' : '¿Por qué falló? (IA)'}
              </button>}
            </div>
            {explanation?.runId === run.id && <div className="ai-explanation">
              <header>
                <strong>Explicación IA</strong>
                <span className="muted">{explanation.model}{explanation.usedFallback ? ' · fallback' : ''}</span>
                <button type="button" className="secondary" onClick={() => setExplanation(null)}>Cerrar</button>
              </header>
              <pre>{explanation.text}</pre>
            </div>}
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

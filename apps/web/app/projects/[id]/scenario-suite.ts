import { RUN_STOP_REQUESTED } from '../../../../api/src/runs/run-cancellation';
import type { ScenarioRun } from './scenario-presentation';

export type SuiteState =
  | { kind: 'waiting' }
  | { kind: 'active'; runId: string; phase: 'queued' | 'running' | 'stopping' }
  | { kind: 'finished'; run: ScenarioRun; quality?: boolean }
  | { kind: 'rejected' | 'unknown'; detail: string };

export type SuiteResult = { scenarioId: string; title: string; state: SuiteState };
type SuiteRequest = Omit<SuiteResult, 'state'> & {
  automationId: string | null;
  quality?: { kind: string; resourceId: string };
};

const runIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function readQualityRun(payload: unknown, id: string): ScenarioRun | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  if (data.id !== id || typeof data.status !== 'string'
    || !['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED'].includes(data.status)) return null;
  return {
    id, scenarioId: null, createdAt: '', status: data.status as ScenarioRun['status'],
    errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
    results: data.passed === true ? [{ status: 'PASSED', durationMs: null }] : [],
  };
}

const unknownSubmission: SuiteState = {
  kind: 'unknown', detail: 'No se pudo confirmar el envío. Consulta el reporte antes de volver a intentarlo.',
};

function waitForUpdate(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    function finish() {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }

    const timer = window.setTimeout(finish, 3000);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export async function runScenarioSuite({
  projectId, scenarios, environmentId, writeAuthorizationAt, signal, onProgress, onWarning,
}: {
  projectId: string;
  scenarios: SuiteRequest[];
  environmentId: string;
  writeAuthorizationAt?: string;
  signal: AbortSignal;
  onProgress: (results: SuiteResult[]) => void;
  onWarning: (warning: string) => void;
}) {
  const results: SuiteResult[] = scenarios.map(({ scenarioId, title }) => ({ scenarioId, title, state: { kind: 'waiting' } }));
  const active = new Map<string, number>();
  const qualityAttempts = new Map<string, string>();
  const qualityIds = scenarios.map(scenario => scenario.quality ? crypto.randomUUID() : null);
  const runsUrl = `/api/projects/${projectId}/runs`;
  let next = 0;

  function update(index: number, state: SuiteState) {
    results[index] = { ...results[index], state };
  }

  async function submit(scenario: SuiteRequest, index: number): Promise<SuiteState> {
    const id = qualityIds[index];
    const qualityUrl = scenario.quality && id
      ? `/api/projects/${projectId}/scenarios/quality/${scenario.quality.kind}/${scenario.quality.resourceId}/executions/${id}`
      : null;
    if (qualityUrl && id) qualityAttempts.set(id, qualityUrl);
    try {
      const response = await fetch(qualityUrl ?? `/api/projects/${projectId}/scenarios/${scenario.scenarioId}/runs`, {
        method: 'POST',
        ...(qualityUrl ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ environmentId, automationId: scenario.automationId, writeAuthorizationAt }),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status < 500 && id) qualityAttempts.delete(id);
      if (response.status === 409 && payload.code === 'RUN_CONCURRENCY_LIMIT') return { kind: 'waiting' };
      if (!response.ok && response.status < 500) {
        const detail = Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message;
        return { kind: 'rejected', detail: typeof detail === 'string' && detail ? detail : 'La API rechazó la ejecución.' };
      }
      if (response.ok && typeof payload.id === 'string' && runIdPattern.test(payload.id) && (!id || payload.id === id)) {
        return { kind: 'active', runId: payload.id, phase: 'queued' };
      }
    } catch { /* El servidor pudo recibir la solicitud. */ }
    if (qualityUrl && id) {
      // The attempt ID makes a status lookup safe after a lost POST response.
      try {
        const response = await fetch(qualityUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (response.ok && readQualityRun(await response.json(), id)) return { kind: 'active', runId: id, phase: 'queued' };
      } catch { /* The attempt could not be confirmed. */ }
    }
    return unknownSubmission;
  }

  async function refreshActive() {
    const ids = [...active.keys()].filter(id => !qualityAttempts.has(id));
    const runs = new Map<string, ScenarioRun>();
    try {
      for (let start = 0; start < ids.length; start += 100) {
        const search = new URLSearchParams({ ids: ids.slice(start, start + 100).join(',') });
        const response = await fetch(`${runsUrl}?${search}`, {
          cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        });
        if (!response.ok) throw new Error('No se pudo consultar la ejecución.');
        const batch: ScenarioRun[] = await response.json();
        if (!Array.isArray(batch)) throw new Error('La API devolvió un estado inválido.');
        for (const run of batch) runs.set(run.id, run);
      }
      await Promise.all([...active.keys()].flatMap(id => {
        const url = qualityAttempts.get(id);
        if (!url) return [];
        return [fetch(url, {
          cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        }).then(async response => {
          if (response.status === 404) return;
          if (!response.ok) throw new Error('No se pudo consultar la ejecución.');
          const run = readQualityRun(await response.json(), id);
          if (!run) throw new Error('La ejecución devolvió un estado inválido.');
          runs.set(id, run);
        })];
      }));
      if (signal.aborted) return false;
    } catch {
      if (!signal.aborted) onWarning('No se pudo actualizar el estado. Reintentando…');
      return false;
    }

    onWarning('');
    const previousActiveCount = active.size;
    let phaseChanged = false;
    for (const [id, index] of active) {
      const run = runs.get(id);
      if (!run) update(index, { kind: 'unknown', detail: 'La ejecución no está disponible. Consulta el reporte.' });
      else if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELED') {
        update(index, { kind: 'finished', run, quality: qualityAttempts.has(id) });
      } else {
        if (run.status !== 'QUEUED' && run.status !== 'RUNNING') continue;
        const phase = run.status === 'QUEUED' ? 'queued' : run.errorCode === RUN_STOP_REQUESTED ? 'stopping' : 'running';
        const previous = results[index].state;
        if (previous.kind === 'active' && previous.phase !== phase) {
          update(index, { ...previous, phase });
          phaseChanged = true;
        }
        continue;
      }
      active.delete(id);
      qualityAttempts.delete(id);
    }
    const settled = active.size < previousActiveCount;
    if (settled || phaseChanged) onProgress([...results]);
    return settled;
  }

  onProgress([...results]);
  while (!signal.aborted && (next < scenarios.length || active.size)) {
    while (next < scenarios.length && !signal.aborted) {
      const state = await submit(scenarios[next], next);
      if (signal.aborted || state.kind === 'waiting') break;
      if (state.kind === 'active') active.set(state.runId, next);
      update(next++, state);
      onProgress([...results]);
    }

    if (signal.aborted) return;
    if (active.size && await refreshActive() && next < scenarios.length) continue;
    if (next < scenarios.length || active.size) await waitForUpdate(signal);
  }
}

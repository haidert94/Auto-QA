'use client';

import { useState } from 'react';
import { useRunActivity } from './run-activity';
import { useScenarioSuite } from './project-tabs';

export function AutomationRunStatus({ projectId, canStop }: { projectId: string; canStop: boolean }) {
  const suite = useScenarioSuite();
  const activity = useRunActivity(projectId, true, suite?.historyVersion);
  const [stopError, setStopError] = useState(false);
  const counts = activity && activity !== 'unavailable' ? activity : null;
  const hasActivity = !!counts && (counts.running > 0 || counts.queued > 0);
  const message = activity === null ? 'Consultando ejecuciones…'
    : activity === 'unavailable' ? 'No se pudo consultar el estado.'
    : hasActivity || activity.stopping
      ? `${activity.running} en ejecución · ${activity.queued} en cola${activity.stopping ? ` · ${activity.stopping} deteniéndose` : ''}`
      : 'Sin ejecuciones en curso ni en cola.';

  async function stop() {
    setStopError(false);
    try {
      await suite?.stop();
    } catch {
      setStopError(true);
    }
  }

  return <section className="automation-run-status" aria-label="Estado de ejecución" data-state={counts?.running ? 'running' : undefined}>
    <strong>Estado de ejecución</strong>
    <div className="automation-run-status__actions">
      <p role="status">{message}</p>
      {canStop && suite && (hasActivity || counts?.stopping || suite.suiteRunning || suite.stopping) ? (
        <button type="button" className="secondary" disabled={suite.stopping || (!hasActivity && !suite.suiteRunning)}
          onClick={() => void stop()}>{suite.stopping || (!hasActivity && counts?.stopping) ? 'Deteniendo…' : 'Detener ejecución'}</button>
      ) : null}
    </div>
    {stopError && <p className="error" role="alert">No se pudo detener la ejecución. Vuelve a intentarlo.</p>}
  </section>;
}

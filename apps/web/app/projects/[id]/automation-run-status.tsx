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
  const stopping = !!suite?.stopping || (!hasActivity && !suite?.suiteRunning && !!counts?.stopping);
  const progress = suite?.progress;

  const activeTests = progress?.filter(({ state }) => state.kind === 'active' && state.phase === 'running') ?? [];
  const queued = progress?.filter(({ state }) => state.kind === 'active' && state.phase === 'queued').length ?? 0;
  const stoppingTests = progress?.filter(({ state }) => state.kind === 'active' && state.phase === 'stopping').length ?? 0;
  const waiting = progress?.filter(({ state }) => state.kind === 'waiting').length ?? 0;
  const finished = progress?.filter(({ state }) => state.kind === 'finished' && state.run.status !== 'CANCELED').length ?? 0;
  const canceled = progress?.filter(({ state }) => state.kind === 'finished' && state.run.status === 'CANCELED').length ?? 0;
  const rejected = progress?.filter(({ state }) => state.kind === 'rejected').length ?? 0;
  const unconfirmed = progress?.filter(({ state }) => state.kind === 'unknown').length ?? 0;
  const suiteCounts = [
    `${activeTests.length} en ejecución`, `${queued} en cola`,
    waiting && `${waiting} por enviar`, stoppingTests && `${stoppingTests} deteniéndose`,
    canceled && `${canceled} ${canceled === 1 ? 'cancelada' : 'canceladas'}`,
    rejected && `${rejected} ${rejected === 1 ? 'no ejecutada' : 'no ejecutadas'}`,
    unconfirmed && `${unconfirmed} sin confirmar`,
  ].filter(Boolean).join(' · ');
  const projectMessage = activity === null ? 'Consultando ejecuciones…'
    : activity === 'unavailable' ? 'No se pudo consultar el estado. Reintentando…'
    : activity.running ? 'El runner ya tomó pruebas del proyecto.'
    : activity.stopping ? 'Esperando confirmación de que las pruebas se detuvieron.'
    : activity.queued ? 'Las pruebas en cola esperan a que el runner las tome.'
    : 'Sin ejecuciones en curso ni en cola.';
  const oldestQueuedMinutes = Math.floor((counts?.oldestQueuedSeconds ?? 0) / 60);

  async function stop() {
    setStopError(false);
    try {
      await suite?.stop();
    } catch {
      setStopError(true);
    }
  }

  return <section className="automation-run-status" aria-label="Estado de ejecución">
    <div className="automation-run-status__header">
      <strong>Estado de ejecución</strong>
      {canStop && suite && (hasActivity || counts?.stopping || suite.suiteRunning || suite.stopping) ? (
        <button type="button" className="secondary" disabled={stopping}
          onClick={() => void stop()}>{stopping ? 'Deteniendo…' : 'Detener ejecución'}</button>
      ) : null}
    </div>
    <div className="automation-run-status__summary" role="status">
      {progress ? <>
        <p><strong>{finished} de {progress.length} pruebas finalizadas</strong></p>
        <p>{suiteCounts}</p>
        {activeTests.length > 0 && <p>En ejecución · {activeTests[0].title}{activeTests.length > 1 && ` y ${activeTests.length - 1} más`}</p>}
        {!activeTests.length && queued > 0 && <p>Las pruebas en cola esperan a que el runner las tome.</p>}
        {suite?.trackingWarning && <p>{suite.trackingWarning} Se muestra el último estado confirmado.</p>}
      </> : <p>{projectMessage}</p>}
      {(!progress || !suite?.suiteRunning) && counts && (hasActivity || counts.stopping > 0) && <p>
        {progress && 'Actividad del proyecto · '}{counts.running} en ejecución · {counts.queued} en cola
        {counts.stopping > 0 && ` · ${counts.stopping} deteniéndose`}
      </p>}
      {counts?.queued && !counts.running && !counts.stopping && !activeTests.length && oldestQueuedMinutes > 0
        ? <p>La prueba más antigua lleva {oldestQueuedMinutes} min en cola.</p> : null}
    </div>
    {progress && <progress aria-label="Pruebas finalizadas" value={finished} max={progress.length} />}
    {stopError && <p className="error" role="alert">No se pudo detener la ejecución. Vuelve a intentarlo.</p>}
  </section>;
}

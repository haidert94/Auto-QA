'use client';

import { useEffect, useState } from 'react';

type RunCounts = { running: number; queued: number };
type RunActivity = RunCounts | 'unavailable' | null;

export function AutomationRunStatus({ projectId }: { projectId: string }) {
  const [activity, setActivity] = useState<RunActivity>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    async function refresh() {
      try {
        const response = await fetch(`/api/projects/${projectId}/runs/activity`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error('No se pudo consultar la actividad.');
        const counts: RunCounts = await response.json();
        if (!counts || !Number.isSafeInteger(counts.running) || counts.running < 0
          || !Number.isSafeInteger(counts.queued) || counts.queued < 0) {
          throw new Error('La API devolvió un estado inválido.');
        }
        if (!controller.signal.aborted) setActivity(counts);
      } catch {
        if (!controller.signal.aborted) setActivity('unavailable');
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void refresh(), 5000);
      }
    }

    void refresh();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [projectId]);

  const running = activity && activity !== 'unavailable' && activity.running > 0;
  const message = activity === null ? 'Consultando ejecuciones…'
    : activity === 'unavailable' ? 'No se pudo consultar el estado.'
    : activity.running || activity.queued ? `${activity.running} en ejecución · ${activity.queued} en cola`
    : 'Sin ejecuciones en curso ni en cola.';

  return <section className="automation-run-status" aria-label="Estado de ejecución" data-state={running ? 'running' : undefined}>
    <strong>Estado de ejecución</strong>
    <p role="status">{message}</p>
  </section>;
}

'use client';

import { useEffect, useState } from 'react';
import { useScenarioSuite } from './project-tabs';

type RunCounts = { running: number; queued: number; stopping: number; oldestQueuedSeconds?: number };
type RunActivity = RunCounts | 'unavailable' | null;

export async function readRunActivity(projectId: string, signal = AbortSignal.timeout(8000)): Promise<RunCounts> {
  const response = await fetch(`/api/projects/${projectId}/runs/activity`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('No se pudo consultar la actividad.');
  const counts: RunCounts = await response.json();
  if (!counts || !Number.isSafeInteger(counts.running) || counts.running < 0
    || !Number.isSafeInteger(counts.queued) || counts.queued < 0
    || !Number.isSafeInteger(counts.stopping) || counts.stopping < 0
    || (counts.oldestQueuedSeconds !== undefined && (!Number.isSafeInteger(counts.oldestQueuedSeconds) || counts.oldestQueuedSeconds < 0))) {
    throw new Error('La API devolvió un estado inválido.');
  }
  return counts;
}

export function hasRunActivity(counts: RunCounts) {
  return counts.running > 0 || counts.queued > 0 || counts.stopping > 0;
}

export function useRunActivity(projectId: string, enabled: boolean, historyVersion?: number) {
  const [activity, setActivity] = useState<RunActivity>(null);

  useEffect(() => {
    if (!enabled) return;
    setActivity(null);
    const controller = new AbortController();
    let timer: number | undefined;

    async function refresh() {
      try {
        const counts = await readRunActivity(projectId, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
        if (!controller.signal.aborted) setActivity(counts);
      } catch {
        if (!controller.signal.aborted) setActivity('unavailable');
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void refresh(), 5000);
      }
    }

    void refresh();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [projectId, enabled, historyVersion]);

  return activity;
}

export function useReportActivity(projectId: string, enabled: boolean) {
  const suite = useScenarioSuite();
  const historyVersion = suite?.historyVersion;
  const activity = useRunActivity(projectId, enabled, historyVersion);
  const counts = activity && activity !== 'unavailable' ? activity : null;
  return {
    historyVersion,
    counts,
    verified: counts !== null,
    statusMessage: activity === null ? 'Consultando el estado de las ejecuciones…'
      : activity === 'unavailable' ? 'No se pudo confirmar el estado de las ejecuciones.' : '',
    waiting: !!(suite?.suiteRunning || suite?.stopping || (counts && hasRunActivity(counts))),
  };
}

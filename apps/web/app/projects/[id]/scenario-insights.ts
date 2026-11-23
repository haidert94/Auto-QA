// Cliente de /scenarios/insights y utilidades de similitud en el navegador.
// Mantener normalizeStepText alineado con apps/api/src/scenarios/step-similarity.ts.

import { useEffect, useState } from 'react';

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'en', 'con', 'sin', 'por', 'para', 'y', 'o', 'u', 'que', 'se', 'su',
  'sus', 'mi', 'tu', 'lo', 'le', 'les', 'es', 'ser', 'estar', 'esta',
  'dado', 'cuando', 'entonces', 'pero', 'ademas',
]);

export function normalizeStepText(input: string): string {
  if (!input) return '';
  const cleaned = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').filter(token => token && !STOPWORDS.has(token)).join(' ');
}

export type StepOccurrence = { scenarioId: string; scenarioTitle: string; ordinal: number; text: string };
export type DuplicateGroup = { normalized: string; canonicalText: string; occurrences: StepOccurrence[]; scenarioCount: number };
export type ScenarioInsights = {
  preparedScenarios?: number; sharedSteps?: number; deviationGroups?: number;
  scenarios: number; steps: number; duplicateGroups: number; duplicatedSteps: number; groups: DuplicateGroup[];
};

export function useScenarioInsights(projectId: string, enabled: boolean, refreshKey: number) {
  const [data, setData] = useState<ScenarioInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/projects/${projectId}/scenarios/insights`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('No se pudieron consultar los duplicados.');
        const body = await response.json();
        if (controller.signal.aborted) return;
        setData(body);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No disponible.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, enabled, refreshKey]);
  return { data, loading, error };
}

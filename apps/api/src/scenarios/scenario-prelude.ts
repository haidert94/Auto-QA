// Capa 1 del pipeline de generación: antes de llamar al LLM, mira si otro
// escenario del proyecto ya tiene automatización preparada y es lo
// suficientemente similar paso a paso como para reutilizarla. Evita
// regenerar código para variantes casi idénticas y reduce ruido en el
// catálogo de specs.
//
// Criterio: mismo número de pasos y promedio de similitud paso-a-paso ≥ 0.9
// usando normalizeStepText + Jaccard de step-similarity.ts.

import { stepSimilarity } from './step-similarity';
import { readAutomationSteps, type GeneratorStep } from './playwright-generator';
import { currentAutomation, type PreparedAutomation } from './automation-agent';

const REUSE_THRESHOLD = 0.9;

type ScenarioForReuse = {
  id: string;
  title: string;
  expectedResult: string | null;
  steps: unknown;
  tags?: unknown;
  automation?: unknown;
};

export type ReuseMatch = {
  sourceScenarioId: string;
  sourceScenarioTitle: string;
  score: number;
  prepared: PreparedAutomation;
};

// Score medio paso-a-paso entre dos secuencias. Requiere mismo largo para
// garantizar que el reuso no corte ni añada pasos del escenario original.
function sequenceScore(a: GeneratorStep[], b: GeneratorStep[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i].data !== b[i].data) return 0;
    total += stepSimilarity(a[i].action, b[i].action);
  }
  return total / a.length;
}

export function findReusableAutomation(
  target: ScenarioForReuse,
  candidates: ScenarioForReuse[],
): ReuseMatch | null {
  const targetSteps = readAutomationSteps(target.steps);
  if (!targetSteps.length) return null;
  let best: ReuseMatch | null = null;
  for (const candidate of candidates) {
    if (candidate.id === target.id || candidate.expectedResult !== target.expectedResult) continue;
    const prepared = currentAutomation(candidate);
    // Una ruta de iframe observada en una ejecución pertenece a ese escenario.
    if (!prepared || prepared.steps.length !== targetSteps.length || prepared.steps.some(step => step.frames)) continue;
    const candidateSteps = readAutomationSteps(candidate.steps);
    if (candidateSteps.length !== targetSteps.length) continue;
    const score = sequenceScore(targetSteps, candidateSteps);
    if (score >= REUSE_THRESHOLD && (!best || score > best.score)) {
      best = {
        sourceScenarioId: candidate.id,
        sourceScenarioTitle: candidate.title,
        score,
        prepared,
      };
    }
  }
  return best;
}

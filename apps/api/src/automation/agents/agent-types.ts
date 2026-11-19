// Tipos compartidos por los 6 agentes de generación. Cada agente recibe
// el contexto del AutomationJob (resultado del revisor + inputs del
// cliente) y devuelve un recuento de lo que creó.

import type { PrismaClient } from '@prisma/client';
import type { AiRouter } from '../../ai/ai-router';
import { MANUAL_SCENARIO_TAG } from '../../scenarios/scenario-tags';
import type { ReviewResult } from '../review-prompt';

export type AgentContext = {
  projectId: string;
  organizationId: string | null;
  jobId: string;
  runKey: string | null;
  environmentId: string | null;
  url: string;
  description: string | null;
  review: ReviewResult;
  requirements?: Array<{ id: string; title: string; criteria: Array<{ text: string }> }>;
};

export type ScenarioPayload = {
  scenarios?: Array<{
    title?: string;
    expectedResult?: string;
    flow?: string;
    regression?: boolean;
    mode?: 'manual' | 'playwright';
    requirementId?: string;
    tags?: string[];
    steps?: Array<{ action?: string; data?: string; expected?: string }>;
  }>;
};

export type AgentOutcome = {
  type: string;
  created: number;
  usedFallback: boolean;
  model: string;
  errors: string[];
};

export type AgentDeps = {
  prisma: PrismaClient;
  router: AiRouter;
};

// Utilidad: extrae un JSON del texto devuelto por la IA. Admite tanto
// bloques "```json ...```" como JSON crudo.
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const brace = candidate.indexOf('{');
  const bracket = candidate.indexOf('[');
  const start = brace === -1 ? bracket : bracket === -1 ? brace : Math.min(brace, bracket);
  if (start < 0) return null;
  try {
    return JSON.parse(candidate.slice(start)) as T;
  } catch {
    try { return JSON.parse(candidate.slice(start, candidate.lastIndexOf(brace === start ? '}' : ']') + 1)) as T; }
    catch { return null; }
  }
}

export function storiesContext(review: ReviewResult): string {
  if (!review.stories.length) return '(sin historias detectadas)';
  return review.stories
    .filter(s => s.coverage !== 'no-cubierta')
    .slice(0, 20)
    .map(s => `- ${s.title} [${s.coverage}]`)
    .join('\n');
}

export function scenarioAnalysisContext(ctx: AgentContext): string {
  const stories = ctx.review.stories.filter(story => story.coverage !== 'no-cubierta').slice(0, 20)
    .map(story => '- ' + story.title + ' [' + story.coverage + ']' + (story.notes ? ' · ' + story.notes : ''));
  const requirements = (ctx.requirements ?? []).map(requirement =>
    '- ' + requirement.id + ' · ' + requirement.title.slice(0, 350)
    + requirement.criteria.map(criterion => '\n  - ' + criterion.text.slice(0, 250)).join(''),
  );
  return [...stories, ...requirements].join('\n') || '(sin historias ni requisitos analizados)';
}

export const MANUAL_SCENARIO_INSTRUCTION = [
  'Para cada caso indica "mode": "playwright" si sus verificaciones se pueden expresar con el vocabulario indicado.',
  'Añade hasta 2 casos con "mode": "manual" si el análisis identifica verificaciones que requieren criterio humano, un dispositivo físico o una acción externa al navegador.',
  'Para el modo manual escribe cada "action" en español natural, sin comandos ni selectores, e incluye un "expectedResult" observable.',
  'Genera casos manuales solo si el análisis aporta una base concreta. Usa "requirementId" si puedes asociar el escenario a uno de los requisitos analizados con identificador.',
].join('\n');

export const REGRESSION_INSTRUCTION = 'Para cada escenario indica "regression": true si debe volver a ejecutarse después de cambios para comprobar que un comportamiento existente identificado en el análisis sigue funcionando. Usa false en los demás casos. Decide de forma independiente del flujo y usa este campo para la clasificación de regresión.';

// Formato Allure: @alfanumerico-con-guiones. Normalizamos y rechazamos lo
// que no case con el patrón del DTO para que el backend no rechace al
// crear el escenario. La lista final queda deduplicada y acotada a 20.
const TAG_PATTERN = /^@[A-Za-z0-9_-]{1,60}$/;
const REGRESSION_TAG = '@regresion';
const REGRESSION_TAG_PATTERN = /^@?(?:regresi[oó]n|regression)$/i;

export function buildTags(
  typeTag: string,
  flow: string | undefined,
  extras: string[] | undefined,
  regression?: boolean,
  manual = false,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  function push(candidate: string) {
    if (!TAG_PATTERN.test(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    result.push(candidate);
  }
  push(typeTag);
  if (manual) push(MANUAL_SCENARIO_TAG);
  const normalizedFlow = typeof flow === 'string' ? flow.trim().toLowerCase() : '';
  if (normalizedFlow === 'basico' || normalizedFlow === 'básico' || normalizedFlow === 'basic') {
    push('@flujoBasico');
  } else if (normalizedFlow === 'alterno' || normalizedFlow === 'alternativo' || normalizedFlow === 'alternate') {
    push('@flujoAlterno');
  }
  const extraTags = Array.isArray(extras) ? extras : [];
  const hasRegressionTag = extraTags.some(tag => typeof tag === 'string' && REGRESSION_TAG_PATTERN.test(tag.trim()));
  if (regression === true || (regression === undefined && hasRegressionTag)) {
    push(REGRESSION_TAG);
  }
  for (const raw of extraTags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim();
    if (REGRESSION_TAG_PATTERN.test(tag)) continue;
    const candidate = tag.startsWith('@') ? tag : '@' + tag;
    if (candidate.toLowerCase() !== MANUAL_SCENARIO_TAG) push(candidate);
    if (result.length >= 20) break;
  }
  return result;
}

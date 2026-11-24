// Tipos compartidos por los 6 agentes de generación. Cada agente recibe
// el contexto del AutomationJob (resultado del revisor + inputs del
// cliente) y devuelve un recuento de lo que creó.

import type { PrismaClient } from '@prisma/client';
import type { AiResponse } from '../../ai/ai-provider';
import type { AiRouter, AiRouterRequest } from '../../ai/ai-router';
import { MANUAL_SCENARIO_TAG } from '../../scenarios/scenario-tags';
import type { ReviewResult } from '../review-prompt';
import type { GeneratedCase } from '../generated-cases';

export type AgentContext = {
  projectId: string;
  organizationId: string | null;
  jobId: string;
  runKey: string | null;
  environmentId: string | null;
  url: string;
  description: string | null;
  review: Pick<ReviewResult, 'stories'>;
  documentTestTypesConfirmed?: boolean;
  documentGenerationSources?: import('../document-generation').DocumentGenerationSources;
  documentRequirementTypes?: import('../document-requirement-types').DocumentRequirementTypes;
  requirements?: Array<{
    id: string; externalKey?: string | null; module?: string | null; title: string; criteria: Array<{ text: string }>;
    scenarios?: Array<{ tags: string[] }>; documentVersionIds?: string[];
  }>;
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
  prisma: Pick<PrismaClient, 'testScenario' | 'monitor' | 'performanceAudit' | 'loadTest' | 'uxAudit'>;
  router: AiRouter;
  batch?: GeneratedCase[];
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

export function storiesContext(review: AgentContext['review']): string {
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
    '- ' + requirement.id + (requirement.externalKey ? ` [${requirement.externalKey}]` : '') + ' · ' + requirement.title.slice(0, 350)
    + (requirement.module ? ' · Módulo: ' + requirement.module : '')
    + requirement.criteria.map(criterion => '\n  - ' + criterion.text.slice(0, 250)).join(''),
  );
  const context = ctx.documentTestTypesConfirmed ? requirements : [...stories, ...requirements];
  return context.join('\n') || '(sin historias ni requisitos analizados)';
}

export function linkedRequirementId(ctx: AgentContext, id: unknown) {
  if (typeof id !== 'string' || !id.trim()) return undefined;
  const reference = id.trim();
  const requirements = ctx.requirements ?? [];
  const direct = requirements.find(requirement => requirement.id === reference);
  if (direct) return direct.criteria.length ? direct.id : undefined;
  const matches = requirements.filter(requirement => requirement.externalKey?.toUpperCase() === reference.toUpperCase());
  return matches.length === 1 && matches[0].criteria.length ? matches[0].id : undefined;
}

export async function requestGeneration<T>(
  router: Pick<AiRouter, 'dispatch'>,
  request: AiRouterRequest,
  hasExpectedList: (payload: T | null) => boolean,
) {
  let response = await router.dispatch(request);
  let parsed = response.usedFallback ? null : extractJson<T>(response.text);
  if (!response.usedFallback && !hasExpectedList(parsed)) {
    response = await router.dispatch({
      ...request,
      prompt: request.prompt + '\n\nSegundo intento. Devuelve un único objeto JSON completo con hasta tres propuestas en total. '
        + 'Usa texto breve y conserva el vínculo, los pasos necesarios y las comprobaciones de cada caso.',
      maxOutputTokens: Math.max(request.maxOutputTokens ?? 2048, 2048),
    });
    parsed = response.usedFallback ? null : extractJson<T>(response.text);
  }
  return { response, parsed: hasExpectedList(parsed) ? parsed : null };
}

export function generationResponseErrors(response: AiResponse, hasExpectedList: boolean): string[] {
  if (response.usedFallback) return [response.fallbackReason ?? 'ai-unavailable'];
  return hasExpectedList ? [] : ['invalid-agent-response'];
}

export const LINKED_REQUIREMENT_INSTRUCTION = 'Cada caso debe incluir requirementId. Copia el ID o la clave documental de una historia o requisito de la lista que sustente el caso. Devuelve una lista vacía si no corresponde ninguno.';

export const MANUAL_SCENARIO_INSTRUCTION = [
  'Para cada caso indica "mode": "playwright" si sus verificaciones se pueden expresar con el vocabulario indicado.',
  'Añade hasta 2 casos con "mode": "manual" si el análisis identifica verificaciones que requieren criterio humano, un dispositivo físico o una acción externa al navegador.',
  'Para el modo manual escribe cada "action" en español natural e incluye un "expectedResult" observable. Añade un paso de comprobación manual con su resultado observable en "expected".',
  'Genera casos manuales sustentados en la historia o requisito indicado por requirementId.',
].join('\n');

export const MANUAL_ONLY_INSTRUCTION = [
  'Genera casos sustentados que una persona pueda ejecutar paso a paso. Prioriza las historias de casos manuales, recorridos de regresión y comprobaciones visuales. Incluye recorridos verificables aunque también puedan automatizarse.',
  'Usa mode: manual y redacta los pasos en español natural con un resultado esperado observable.',
  'Incluye al menos un paso de comprobación con el valor expected. Si no hay casos sustentados, devuelve la lista vacía.',
].join('\n');

export const ASSERTION_INSTRUCTION = [
  'Cada escenario automatizable debe incluir un paso de aserción explícita que compruebe su resultado esperado.',
  'Usa expect-text para texto visible, expect-url para una ruta exacta esperada o expect-visible, expect-hidden y expect-checked para estados de un selector CSS.',
  'Usa expect-http-ok solo si el objetivo del caso es comprobar que una página responde correctamente. Su argumento es la ruta de la página.',
  'Una navegación, un clic y la descripción del resultado esperado por sí solos no constituyen una aserción. Para flujos positivos y negativos verifica el efecto observable correspondiente. Omite el caso si no puedes identificar una comprobación sustentada.',
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

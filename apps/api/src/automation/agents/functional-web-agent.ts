// Agente funcional web: genera TestScenario con pasos en el vocabulario
// controlado (navigate:, click:, fill:, press:, expect-text:, expect-url:).

import type { Prisma } from '@prisma/client';
import { type AgentContext, type AgentDeps, type AgentOutcome, extractJson, storiesContext } from './agent-types';

type ScenarioPayload = {
  scenarios?: Array<{
    title?: string;
    expectedResult?: string;
    steps?: Array<{ action?: string; data?: string; expected?: string }>;
  }>;
};

export async function runFunctionalWebAgent(ctx: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  const prompt = [
    'Genera entre 3 y 8 escenarios de prueba funcional web para la aplicación descrita.',
    `URL base: ${ctx.url}`,
    ctx.description ? `Descripción: ${ctx.description}` : '',
    '',
    'Historias de usuario detectadas:',
    storiesContext(ctx.review),
    '',
    'Vocabulario de pasos permitido (prefijos reconocidos por el worker Playwright):',
    '- navigate: <ruta relativa o URL>',
    '- click: <selector css>',
    '- fill: <selector css>   (+ "data": valor a escribir)',
    '- press: <tecla>',
    '- expect-text: <texto visible>',
    '- expect-url: <patrón>',
    '',
    'Responde SOLO JSON válido con la estructura:',
    '{ "scenarios": [ { "title": "...", "expectedResult": "...", "steps": [ { "action": "navigate: /login" }, ... ] } ] }',
  ].filter(Boolean).join('\n');

  const response = await deps.router.dispatch({
    operation: 'scenario-generation',
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    runKey: ctx.runKey,
    prompt,
    systemPrompt: 'Eres un ingeniero QA senior. Responde SOLO con JSON válido.',
    maxOutputTokens: 3000,
  });

  const parsed = extractJson<ScenarioPayload>(response.text) ?? {};
  const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios.slice(0, 10) : [];
  const errors: string[] = [];
  let created = 0;

  for (const [index, s] of scenarios.entries()) {
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    if (!title) { errors.push('scenario-' + index + '-sin-titulo'); continue; }
    const steps = Array.isArray(s.steps) ? s.steps : [];
    const normalized = steps
      .filter(step => typeof step?.action === 'string' && step.action.trim())
      .slice(0, 50)
      .map((step, i) => ({
        ordinal: i + 1,
        action: step.action!.trim().slice(0, 1000),
        data: typeof step.data === 'string' ? step.data.slice(0, 1000) : undefined,
        expected: typeof step.expected === 'string' ? step.expected.slice(0, 1000) : undefined,
      }));
    if (!normalized.length) { errors.push('scenario-' + index + '-sin-pasos'); continue; }
    try {
      await deps.prisma.testScenario.create({
        data: {
          projectId: ctx.projectId,
          title: title.slice(0, 300),
          expectedResult: typeof s.expectedResult === 'string' ? s.expectedResult.slice(0, 2000) : null,
          steps: normalized as unknown as Prisma.InputJsonValue,
        },
      });
      created += 1;
    } catch (error) {
      errors.push('scenario-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  return { type: 'functional_web', created, usedFallback: response.usedFallback ?? false, model: response.model, errors };
}

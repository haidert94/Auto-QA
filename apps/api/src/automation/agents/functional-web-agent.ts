// Genera escenarios web con pasos de Playwright o instrucciones de ejecución manual.

import type { Prisma } from '@prisma/client';
import { MANUAL_SCENARIO_TAG } from '../../scenarios/scenario-tags';
import { hasPlaywrightAssertion } from '../../scenarios/playwright-generator';
import { ASSERTION_INSTRUCTION, buildTags, type AgentContext, type AgentDeps, type AgentOutcome, extractJson, generationResponseErrors, linkedRequirementId, LINKED_REQUIREMENT_INSTRUCTION, MANUAL_ONLY_INSTRUCTION, MANUAL_SCENARIO_INSTRUCTION, REGRESSION_INSTRUCTION, scenarioAnalysisContext, type ScenarioPayload } from './agent-types';

export async function runFunctionalWebAgent(ctx: AgentContext, deps: AgentDeps, onlyManual = false): Promise<AgentOutcome> {
  const allowMixed = !onlyManual && !ctx.documentTestTypesConfirmed;
  const prompt = [
    onlyManual ? MANUAL_ONLY_INSTRUCTION : 'Genera entre 3 y 8 escenarios automatizables de prueba funcional web para la aplicación descrita.',
    `URL base: ${ctx.url}`,
    ctx.description ? `Descripción: ${ctx.description}` : '',
    '',
    'Historias y requisitos analizados:',
    scenarioAnalysisContext(ctx),
    LINKED_REQUIREMENT_INSTRUCTION,
    '',
    ...(!onlyManual ? [
      'Vocabulario de pasos para los casos automatizables:',
      '- navigate: <ruta relativa o URL>',
      '- click: <selector css>',
      '- fill: <selector css>   (+ "data": valor a escribir)',
      '- press: <tecla>',
      '- expect-text: <texto visible>',
      '- expect-url: <ruta exacta>',
    ] : []),
    '',
    'Para cada escenario marca el flujo:',
    '- "flow": "basico" cuando sea el camino feliz principal de una historia.',
    '- "flow": "alterno" para variantes, validaciones, errores o caminos secundarios.',
    'Mezcla básicos y alternos: un flujo alterno suele acompañar a uno básico de la misma historia.',
    '',
    onlyManual ? '' : ASSERTION_INSTRUCTION,
    allowMixed ? MANUAL_SCENARIO_INSTRUCTION : '',
    REGRESSION_INSTRUCTION,
    'Opcionalmente añade "tags" extra con prefijo @ y sin espacios (ej: @smoke, @critico, @login).',
    '',
    'Responde SOLO JSON válido con la estructura:',
    onlyManual
      ? '{ "scenarios": [{ "title": "Revisar legibilidad del resumen", "mode": "manual", "requirementId": "id del requisito", "expectedResult": "El resumen se comprende sin ayuda.", "steps": [{ "action": "Lee las instrucciones del resumen.", "expected": "Se entiende cómo continuar." }] }] }'
      : '{ "scenarios": [ { "title": "Consultar resumen", "expectedResult": "Se muestra Resumen", "flow": "basico", "mode": "playwright", "requirementId": "id del requisito", "regression": true, "tags": ["@resumen"], "steps": [ { "action": "navigate: /resumen" }, { "action": "expect-text: Resumen" } ] } ] }',
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
  const errors = generationResponseErrors(response, Array.isArray(parsed.scenarios));
  let created = 0;

  for (const [index, s] of scenarios.entries()) {
    const title = typeof s?.title === 'string' ? s.title.trim() : '';
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
    const manual = s.mode === 'manual';
    if (!allowMixed && manual !== onlyManual) continue;
    const expectedResult = typeof s.expectedResult === 'string' ? s.expectedResult.slice(0, 2000) : null;
    if (manual && !expectedResult?.trim()) { errors.push('scenario-' + index + '-sin-resultado-esperado'); continue; }
    const hasAssertion = manual ? normalized.some(step => step.expected?.trim()) : hasPlaywrightAssertion(normalized);
    if (!hasAssertion) { errors.push('scenario-' + index + '-sin-asercion'); continue; }
    const requirementId = linkedRequirementId(ctx, s.requirementId);
    if (!requirementId) {
      errors.push('scenario-' + index + '-sin-requisito-verificable');
      continue;
    }
    const tags = buildTags(onlyManual ? MANUAL_SCENARIO_TAG : '@funcional', s.flow, s.tags, s.regression, manual);
    try {
      await deps.prisma.testScenario.create({
        data: {
          projectId: ctx.projectId,
          title: title.slice(0, 300),
          expectedResult,
          requirementId,
          tags,
          steps: normalized as unknown as Prisma.InputJsonValue,
        } as Prisma.TestScenarioUncheckedCreateInput,
      });
      created += 1;
    } catch (error) {
      errors.push('scenario-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  return { type: onlyManual ? 'manual' : 'functional_web', created, usedFallback: response.usedFallback ?? false, model: response.model, errors };
}

// Genera escenarios web con pasos de Playwright o instrucciones de ejecución manual.

import type { Prisma } from '@prisma/client';
import { recordGeneratedCase } from '../generated-cases';
import { MANUAL_SCENARIO_TAG } from '../../scenarios/scenario-tags';
import { hasPlaywrightAssertion } from '../../scenarios/playwright-generator';
import { ASSERTION_INSTRUCTION, buildTags, elementInventoryBlock, type AgentContext, type AgentDeps, type AgentOutcome, generationResponseErrors, linkedRequirementId, LINKED_REQUIREMENT_INSTRUCTION, MANUAL_ONLY_INSTRUCTION, MANUAL_SCENARIO_INSTRUCTION, REGRESSION_INSTRUCTION, requestGeneration, sanitizeStepFallbacks, scenarioAnalysisContext, type ScenarioPayload } from './agent-types';

export async function runFunctionalWebAgent(ctx: AgentContext, deps: AgentDeps, onlyManual = false): Promise<AgentOutcome> {
  const allowMixed = !onlyManual && !ctx.documentTestTypesConfirmed;
  const prompt = [
    onlyManual ? MANUAL_ONLY_INSTRUCTION : 'Genera entre 3 y 8 escenarios automatizables de prueba funcional web para la aplicación descrita.',
    onlyManual ? 'Genera hasta 5 casos manuales con pasos concisos.' : 'Describe solo los pasos necesarios y las aserciones de cada caso.',
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
      '- click-text: <texto exacto visible> (preferido sobre click cuando el elemento no tiene selector estable; coincide por accesibilidad, no por CSS)',
      '- fill: <selector css>   (+ "data": valor a escribir)',
      '- fill-label: <etiqueta del campo>   (+ "data": valor a escribir; preferido sobre fill cuando el campo tiene una etiqueta visible)',
      '- press: <tecla>',
      '- expect-text: <texto visible>',
      '- expect-url: <ruta exacta>',
      '- hover: <selector css>   (para revelar tooltips, menús desplegables, estados hover)',
      '- hover-text: <texto exacto visible>   (variante accesible)',
      '- scroll-into-view: <selector css>   (lleva el elemento al viewport antes de interactuar; útil en listas largas o tablas con scroll virtual)',
      '- select: <selector css>   (+ "data": valor del <option> a seleccionar en un <select>)',
      '- select-label: <etiqueta del select>   (+ "data": valor del <option>; variante accesible)',
      '- drag-to: <selector origen>   (+ "data": selector CSS del destino; arrastra y suelta)',
      '',
      'Cuando el inventario tenga dos pistas para el MISMO elemento (p. ej. un data-testid y el texto visible, o un name y una etiqueta), añade al paso un array "fallbacks" con la pista alterna como acción DSL del mismo verbo. Se traduce a Playwright Locator.or(): si el selector principal cambia, el test sobrevive con la alternativa. Máximo 2 fallbacks por paso.',
      'Ejemplo: {"action":"click: [data-testid=\\"save\\"]","fallbacks":["click-text: Guardar"]}.',
    ] : []),
    !onlyManual ? elementInventoryBlock(ctx) : '',
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

  const { response, parsed } = await requestGeneration<ScenarioPayload>(deps.router, {
    operation: 'scenario-generation',
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    runKey: ctx.runKey,
    prompt,
    systemPrompt: 'Eres un ingeniero QA senior. Responde SOLO con JSON válido.',
    maxOutputTokens: 5000,
  }, payload => Array.isArray(payload?.scenarios));

  const scenarios = Array.isArray(parsed?.scenarios) ? parsed.scenarios.slice(0, 10) : [];
  const errors = generationResponseErrors(response, parsed !== null);
  let created = 0;

  for (const [index, s] of scenarios.entries()) {
    const title = typeof s?.title === 'string' ? s.title.trim() : '';
    if (!title) { errors.push('scenario-' + index + '-sin-titulo'); continue; }
    const steps = Array.isArray(s.steps) ? s.steps : [];
    const normalized = steps
      .filter(step => typeof step?.action === 'string' && step.action.trim())
      .slice(0, 50)
      .map((step, i) => {
        const action = step.action!.trim().slice(0, 1000);
        return {
          ordinal: i + 1,
          action,
          data: typeof step.data === 'string' ? step.data.slice(0, 1000) : undefined,
          expected: typeof step.expected === 'string' ? step.expected.slice(0, 1000) : undefined,
          fallbacks: sanitizeStepFallbacks(action, step.fallbacks),
        };
      });
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
      await recordGeneratedCase(deps, { kind: 'scenario',
        data: {
          projectId: ctx.projectId,
          title: title.slice(0, 300),
          expectedResult,
          requirementId,
          tags,
          steps: normalized as unknown as Prisma.InputJsonValue,
        } as Prisma.TestScenarioCreateManyInput,
      });
      created += 1;
    } catch (error) {
      errors.push('scenario-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  return { type: onlyManual ? 'manual' : 'functional_web', created, usedFallback: response.usedFallback ?? false, model: response.model, errors };
}

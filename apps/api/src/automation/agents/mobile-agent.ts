// Agente mobile emulado: genera TestScenario con pasos mobile-first.
// No crea TestRun — solo escenarios. Cuando el usuario los ejecute podrá
// elegir el dispositivo en el panel de runs.

import type { Prisma } from '@prisma/client';
import { recordGeneratedCase } from '../generated-cases';
import { hasPlaywrightAssertion } from '../../scenarios/playwright-generator';
import { ASSERTION_INSTRUCTION, buildTags, type AgentContext, type AgentDeps, type AgentOutcome, generationResponseErrors, linkedRequirementId, LINKED_REQUIREMENT_INSTRUCTION, MANUAL_SCENARIO_INSTRUCTION, REGRESSION_INSTRUCTION, requestGeneration, scenarioAnalysisContext, type ScenarioPayload } from './agent-types';

export async function runMobileAgent(ctx: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  const prompt = [
    'Genera entre 2 y 5 escenarios automatizables para navegadores móviles (viewport pequeño, interacciones táctiles).',
    `URL base: ${ctx.url}`,
    ctx.description ? `Descripción: ${ctx.description}` : '',
    '',
    'Historias y requisitos analizados:',
    scenarioAnalysisContext(ctx),
    LINKED_REQUIREMENT_INSTRUCTION,
    '',
    'Traslada las historias seleccionadas a un navegador móvil emulado. Prioriza los tamaños, orientación, controles y flujos declarados en los requisitos. No inventes gestos, controles ni endpoints.',
    'Usa el vocabulario navigate:/click:/fill:/press:/expect-text:/expect-url: para los casos automatizables y el prefijo [MOBILE] en todos los títulos.',
    '',
    'Para cada escenario marca el flujo:',
    '- "flow": "basico" para el camino feliz de la historia en móvil.',
    '- "flow": "alterno" para errores, validaciones o variantes.',
    ASSERTION_INSTRUCTION,
    ctx.documentTestTypesConfirmed ? '' : MANUAL_SCENARIO_INSTRUCTION,
    REGRESSION_INSTRUCTION,
    'Opcionalmente añade "tags" extra con prefijo @ (ej: @menu, @formulario).',
    '',
    'Responde SOLO JSON { "scenarios": [{ "title": "[MOBILE] Abrir menú", "expectedResult": "Se muestra la opción Productos", "flow": "basico", "mode": "playwright", "requirementId": "id del requisito", "regression": true, "tags": ["@menu"], "steps": [{ "action": "click: #menu" }, { "action": "expect-text: Productos" }] }] }.',
  ].filter(Boolean).join('\n');

  const { response, parsed } = await requestGeneration<ScenarioPayload>(deps.router, {
    operation: 'scenario-generation',
    organizationId: ctx.organizationId, projectId: ctx.projectId, runKey: ctx.runKey,
    prompt, systemPrompt: 'QA senior especialista en mobile web. SOLO JSON válido.',
    maxOutputTokens: 2000,
  }, payload => Array.isArray(payload?.scenarios));

  const scenarios = Array.isArray(parsed?.scenarios) ? parsed.scenarios.slice(0, 8) : [];
  const errors = generationResponseErrors(response, parsed !== null);
  let created = 0;

  for (const [index, s] of scenarios.entries()) {
    const title = typeof s?.title === 'string' ? s.title.trim() : '';
    if (!title) { errors.push('mobile-' + index + '-sin-titulo'); continue; }
    const steps = (Array.isArray(s.steps) ? s.steps : [])
      .filter(step => typeof step?.action === 'string' && step.action.trim())
      .slice(0, 40)
      .map((step, i) => ({
        ordinal: i + 1,
        action: step.action!.trim().slice(0, 1000),
        data: typeof step.data === 'string' ? step.data.slice(0, 1000) : undefined,
        expected: typeof step.expected === 'string' ? step.expected.slice(0, 1000) : undefined,
      }));
    if (!steps.length) { errors.push('mobile-' + index + '-sin-pasos'); continue; }
    const manual = s.mode === 'manual';
    if (manual && ctx.documentTestTypesConfirmed) continue;
    const expectedResult = typeof s.expectedResult === 'string' ? s.expectedResult.slice(0, 2000) : null;
    if (manual && !expectedResult?.trim()) { errors.push('mobile-' + index + '-sin-resultado-esperado'); continue; }
    const hasAssertion = manual ? steps.some(step => step.expected?.trim()) : hasPlaywrightAssertion(steps);
    if (!hasAssertion) { errors.push('mobile-' + index + '-sin-asercion'); continue; }
    const requirementId = linkedRequirementId(ctx, s.requirementId);
    if (!requirementId) {
      errors.push('scenario-' + index + '-sin-requisito-verificable');
      continue;
    }
    const tags = buildTags('@mobile', s.flow, s.tags, s.regression, manual);
    try {
      await recordGeneratedCase(deps, { kind: 'scenario',
        data: {
          projectId: ctx.projectId,
          title: (title.startsWith('[MOBILE]') ? title : '[MOBILE] ' + title).slice(0, 300),
          expectedResult,
          requirementId,
          tags,
          steps: steps as unknown as Prisma.InputJsonValue,
        } as Prisma.TestScenarioCreateManyInput,
      });
      created += 1;
    } catch (error) {
      errors.push('mobile-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  return { type: 'mobile_emulated', created, usedFallback: response.usedFallback ?? false, model: response.model, errors };
}

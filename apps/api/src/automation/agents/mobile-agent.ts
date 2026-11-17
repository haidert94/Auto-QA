// Agente mobile emulado: genera TestScenario con pasos mobile-first.
// No crea TestRun — solo escenarios. Cuando el usuario los ejecute podrá
// elegir el dispositivo en el panel de runs.

import type { Prisma } from '@prisma/client';
import { buildTags, type AgentContext, type AgentDeps, type AgentOutcome, extractJson, storiesContext } from './agent-types';

type Payload = {
  scenarios?: Array<{
    title?: string;
    expectedResult?: string;
    flow?: 'basico' | 'alterno' | string;
    tags?: string[];
    steps?: Array<{ action?: string; data?: string; expected?: string }>;
  }>;
};

export async function runMobileAgent(ctx: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  const prompt = [
    'Genera entre 2 y 5 escenarios de prueba optimizados para navegadores móviles (viewport pequeño, interacciones táctiles).',
    `URL base: ${ctx.url}`,
    ctx.description ? `Descripción: ${ctx.description}` : '',
    '',
    'Historias relevantes:',
    storiesContext(ctx.review),
    '',
    'Enfócate en: menús hamburguesa, formularios, scroll, botones grandes, gestos táctiles.',
    'Usa el vocabulario navigate:/click:/fill:/press:/expect-text:/expect-url: y marca los escenarios con el prefijo [MOBILE] en el título.',
    '',
    'Para cada escenario marca el flujo:',
    '- "flow": "basico" para el camino feliz de la historia en móvil.',
    '- "flow": "alterno" para errores, validaciones o variantes.',
    'Opcionalmente añade "tags" extra con prefijo @ (ej: @menu, @formulario).',
    '',
    'Responde SOLO JSON { "scenarios": [{ "title": "[MOBILE] ...", "expectedResult": "...", "flow": "basico", "tags": ["@menu"], "steps": [...] }] }.',
  ].filter(Boolean).join('\n');

  const response = await deps.router.dispatch({
    operation: 'scenario-generation',
    organizationId: ctx.organizationId, projectId: ctx.projectId, runKey: ctx.runKey,
    prompt, systemPrompt: 'QA senior especialista en mobile web. SOLO JSON válido.',
    maxOutputTokens: 2000,
  });

  const parsed = extractJson<Payload>(response.text) ?? {};
  const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios.slice(0, 8) : [];
  const errors: string[] = [];
  let created = 0;

  for (const [index, s] of scenarios.entries()) {
    const title = typeof s.title === 'string' ? s.title.trim() : '';
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
    const tags = buildTags('@mobile', s.flow, s.tags);
    try {
      await deps.prisma.testScenario.create({
        data: {
          projectId: ctx.projectId,
          title: (title.startsWith('[MOBILE]') ? title : '[MOBILE] ' + title).slice(0, 300),
          expectedResult: typeof s.expectedResult === 'string' ? s.expectedResult.slice(0, 2000) : null,
          tags,
          steps: steps as unknown as Prisma.InputJsonValue,
        } as Prisma.TestScenarioUncheckedCreateInput,
      });
      created += 1;
    } catch (error) {
      errors.push('mobile-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  return { type: 'mobile_emulated', created, usedFallback: response.usedFallback ?? false, model: response.model, errors };
}

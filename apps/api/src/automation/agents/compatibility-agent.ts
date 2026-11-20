// Agente compatibilidad: duplica los escenarios funcionales existentes
// con una marca por navegador para que el cliente pueda ejecutar el
// mismo flujo en Chromium/Firefox/WebKit. No llama a IA — es puramente
// mecánico sobre los TestScenario que ya existen.
//
// Si no hay escenarios todavía (porque el cliente no eligió "funcional
// web"), genera un escenario base mínimo para que la selección
// "compatibilidad" no quede vacía.

import type { Prisma } from '@prisma/client';
import { hasPlaywrightAssertion, readGeneratorSteps } from '../../scenarios/playwright-generator';
import { MANUAL_SCENARIO_TAG } from '../../scenarios/scenario-tags';
import { type AgentContext, type AgentDeps, type AgentOutcome } from './agent-types';

const BROWSERS = [
  { enum: 'CHROMIUM', tag: '@chromium' },
  { enum: 'FIREFOX', tag: '@firefox' },
  { enum: 'WEBKIT', tag: '@webkit' },
] as const;

export async function runCompatibilityAgent(ctx: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  const existing = await deps.prisma.testScenario.findMany({
    where: {
      projectId: ctx.projectId,
      archivedAt: null,
      NOT: { OR: [
        { title: { startsWith: '[COMPAT]' } },
        { title: { startsWith: '[COMPAT:' } },
        { tags: { hasSome: [MANUAL_SCENARIO_TAG, '@compatibility'] } },
      ] },
    },
    take: 25,
    orderBy: { title: 'asc' },
    select: { title: true, steps: true, expectedResult: true, tags: true } as const,
  });

  const verified = existing.filter(scenario => hasPlaywrightAssertion(readGeneratorSteps(scenario.steps))).slice(0, 5);
  const base = verified.length ? verified : [{
    title: 'Página de inicio accesible',
    steps: [{ ordinal: 1, action: 'expect-http-ok: ' + ctx.url }],
    expectedResult: 'La página de inicio responde con un estado HTTP exitoso (2xx).',
    tags: ['@funcional', '@flujoBasico'],
  }];

  const errors: string[] = [];
  let created = 0;

  for (const scenario of base) {
    for (const browser of BROWSERS) {
      // Hereda los tags del escenario base + añade @compatibility y el tag
      // del navegador. Deduplica preservando orden de llegada.
      const inherited = Array.isArray(scenario.tags) ? scenario.tags : [];
      const tags = Array.from(new Set([...inherited, '@compatibility', browser.tag])).slice(0, 20);
      try {
        await deps.prisma.testScenario.create({
          data: {
            projectId: ctx.projectId,
            title: ('[COMPAT:' + browser.enum + '] ' + scenario.title).slice(0, 300),
            expectedResult: scenario.expectedResult,
            tags,
            steps: scenario.steps as Prisma.InputJsonValue,
          } as Prisma.TestScenarioUncheckedCreateInput,
        });
        created += 1;
      } catch (error) {
        errors.push('compat-' + browser.enum + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
      }
    }
  }

  return { type: 'compatibility', created, usedFallback: true, model: 'rule-based', errors };
}

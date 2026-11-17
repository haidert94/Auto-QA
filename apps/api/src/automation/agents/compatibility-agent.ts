// Agente compatibilidad: duplica los escenarios funcionales existentes
// con una marca por navegador para que el cliente pueda ejecutar el
// mismo flujo en Chromium/Firefox/WebKit. No llama a IA — es puramente
// mecánico sobre los TestScenario que ya existen.
//
// Si no hay escenarios todavía (porque el cliente no eligió "funcional
// web"), genera un escenario base mínimo para que la selección
// "compatibilidad" no quede vacía.

import type { Prisma } from '@prisma/client';
import { type AgentContext, type AgentDeps, type AgentOutcome } from './agent-types';

const BROWSERS = ['CHROMIUM', 'FIREFOX', 'WEBKIT'] as const;

export async function runCompatibilityAgent(ctx: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  const existing = await deps.prisma.testScenario.findMany({
    where: { projectId: ctx.projectId, NOT: { title: { startsWith: '[COMPAT]' } } },
    take: 5,
    orderBy: { title: 'asc' },
    select: { title: true, steps: true, expectedResult: true },
  });

  const base = existing.length ? existing : [{
    title: 'Página de inicio accesible',
    steps: [{ ordinal: 1, action: 'navigate: ' + ctx.url }] as unknown as Prisma.JsonValue,
    expectedResult: 'La página de inicio carga sin errores.',
  }];

  const errors: string[] = [];
  let created = 0;

  for (const scenario of base) {
    for (const browser of BROWSERS) {
      try {
        await deps.prisma.testScenario.create({
          data: {
            projectId: ctx.projectId,
            title: ('[COMPAT:' + browser + '] ' + scenario.title).slice(0, 300),
            expectedResult: scenario.expectedResult,
            steps: scenario.steps as Prisma.InputJsonValue,
          },
        });
        created += 1;
      } catch (error) {
        errors.push('compat-' + browser + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
      }
    }
  }

  return { type: 'compatibility', created, usedFallback: true, model: 'rule-based', errors };
}

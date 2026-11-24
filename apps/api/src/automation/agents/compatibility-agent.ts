// Agente compatibilidad: duplica los escenarios funcionales existentes
// con una marca por navegador para que el cliente pueda ejecutar el
// mismo flujo en Chromium/Firefox/WebKit. No llama a IA — es puramente
// mecánico sobre los TestScenario que ya existen.
//
// Cada variante conserva la historia o requisito del caso base.

import type { Prisma } from '@prisma/client';
import { recordGeneratedCase } from '../generated-cases';
import { hasPlaywrightAssertion, readGeneratorSteps } from '../../scenarios/playwright-generator';
import { COMPATIBILITY_SCENARIO_TAG, COMPATIBILITY_SCENARIO_TAGS, MANUAL_SCENARIO_TAG } from '../../scenarios/scenario-tags';
import { linkedRequirementId, type AgentContext, type AgentDeps, type AgentOutcome } from './agent-types';

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
      requirementId: { in: (ctx.requirements ?? []).filter(item => item.criteria.length > 0).map(item => item.id) },
      requirementReviewRequiredAt: null,
      NOT: { OR: [
        { title: { startsWith: '[COMPAT]' } },
        { title: { startsWith: '[COMPAT:' } },
        { tags: { hasSome: [MANUAL_SCENARIO_TAG, ...COMPATIBILITY_SCENARIO_TAGS] } },
      ] },
    },
    take: ctx.completingCoverage ? undefined : 25,
    orderBy: { title: 'asc' },
    select: { title: true, requirementId: true, steps: true, expectedResult: true, tags: true } as const,
  });

  const staged = (deps.batch ?? []).flatMap(candidate => {
    if (candidate.kind !== 'scenario' || candidate.data.projectId !== ctx.projectId) return [];
    const { title, requirementId, expectedResult, steps, tags } = candidate.data;
    if (!Array.isArray(tags) || tags.includes(MANUAL_SCENARIO_TAG) || COMPATIBILITY_SCENARIO_TAGS.some(tag => tags.includes(tag))) return [];
    return [{ title, requirementId, expectedResult, steps, tags }];
  });
  const candidates = [...existing, ...staged].filter(scenario => linkedRequirementId(ctx, scenario.requirementId)
    && hasPlaywrightAssertion(readGeneratorSteps(scenario.steps)));
  const base = ctx.completingCoverage
    ? [...new Map(candidates.map(scenario => [scenario.requirementId, scenario])).values()]
    : candidates.slice(0, 5);
  const errors = base.length ? [] : ['compatibility-no-linked-base'];
  let created = 0;

  for (const scenario of base) {
    for (const browser of BROWSERS) {
      const required: string[] = [COMPATIBILITY_SCENARIO_TAG, browser.tag];
      const inherited = [...new Set(scenario.tags)].filter(tag => !required.includes(tag));
      const tags = [...inherited.slice(0, 20 - required.length), ...required];
      try {
        const title = ('[COMPAT:' + browser.enum + '] ' + scenario.title).slice(0, 300);
        const alreadyStaged = deps.batch?.some(candidate => candidate.kind === 'scenario' &&
          candidate.data.title === title && candidate.data.requirementId === scenario.requirementId);
        if (alreadyStaged || await deps.prisma.testScenario.findFirst({
          where: { projectId: ctx.projectId, archivedAt: null, title, requirementId: scenario.requirementId },
          select: { id: true },
        })) continue;
        await recordGeneratedCase(deps, { kind: 'scenario',
          data: {
            projectId: ctx.projectId,
            title,
            requirementId: scenario.requirementId,
            expectedResult: scenario.expectedResult,
            tags,
            steps: scenario.steps as Prisma.InputJsonValue,
          } as Prisma.TestScenarioCreateManyInput,
        });
        created += 1;
      } catch (error) {
        errors.push('compat-' + browser.enum + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
      }
    }
  }

  return { type: 'compatibility', created, usedFallback: true, model: 'rule-based', errors };
}

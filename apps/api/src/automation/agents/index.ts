// Orquestador de los agentes. Ejecuta en paralelo los seleccionados y
// devuelve los outcomes para que el worker persista el resultado en
// AutomationJob.result.

import { MANUAL_SCENARIO_TAG } from '../../scenarios/scenario-tags';
import type { AgentContext, AgentDeps, AgentOutcome } from './agent-types';
import { runAvailabilityAgent } from './availability-agent';
import { runCompatibilityAgent } from './compatibility-agent';
import { runFunctionalWebAgent } from './functional-web-agent';
import { runMobileAgent } from './mobile-agent';
import { runPerformanceAgent } from './performance-agent';
import { runUxAgent } from './ux-agent';

const AGENTS: Record<string, (ctx: AgentContext, deps: AgentDeps) => Promise<AgentOutcome>> = {
  functional_web: runFunctionalWebAgent,
  mobile_emulated: runMobileAgent,
  compatibility: runCompatibilityAgent,
  availability: runAvailabilityAgent,
  performance: runPerformanceAgent,
  ux: runUxAgent,
  manual: (ctx, deps) => runFunctionalWebAgent(ctx, deps, true),
};

function scenarioType(tags: string[]) {
  if (tags.includes(MANUAL_SCENARIO_TAG)) return 'manual';
  if (tags.includes('@compatibility')) return 'compatibility';
  if (tags.includes('@mobile')) return 'mobile_emulated';
  return 'functional_web';
}

function agentContext(ctx: AgentContext, type: string): AgentContext {
  if (!ctx.documentTestTypesConfirmed) return ctx;
  const requirements = ctx.requirements ?? [];
  const missing = ['functional_web', 'mobile_emulated', 'manual'].includes(type)
    ? requirements.filter(requirement => !requirement.scenarios?.some(scenario => scenarioType(scenario.tags) === type)).slice(0, 20)
    : requirements;
  return {
    ...ctx,
    requirements: missing,
    review: {
      ...ctx.review,
      stories: missing.slice(0, 20).map(requirement => ({
        title: [requirement.title, ...requirement.criteria.map(criterion => criterion.text)].join(' · ').slice(0, 600),
        coverage: 'completa',
      })),
    },
  };
}

export async function runSelectedAgents(
  selection: string[], ctx: AgentContext, deps: AgentDeps,
): Promise<AgentOutcome[]> {
  const unique = Array.from(new Set(selection)).filter(t => AGENTS[t]);
  // Ejecutamos en paralelo pero capturamos errores individualmente para
  // que un fallo en un agente no cancele a los demás.
  async function run(type: string): Promise<AgentOutcome> {
    try {
      const context = agentContext(ctx, type);
      if (context.documentTestTypesConfirmed && !context.requirements?.length) {
        return { type, created: 0, usedFallback: false, model: 'not-called', errors: [] };
      }
      return await AGENTS[type](context, deps);
    } catch (error) {
      return {
        type, created: 0, usedFallback: true, model: 'rule-based',
        errors: ['agent-crashed-' + (error instanceof Error ? error.message.slice(0, 120) : 'unknown')],
      } satisfies AgentOutcome;
    }
  }
  const compatibilityAfterBase = ctx.documentTestTypesConfirmed && unique.includes('compatibility');
  const outcomes = await Promise.all(unique.filter(type => !compatibilityAfterBase || type !== 'compatibility').map(run));
  if (compatibilityAfterBase) outcomes.push(await run('compatibility'));
  return outcomes;
}

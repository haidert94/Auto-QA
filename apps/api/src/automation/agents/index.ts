// Orquestador de los 6 agentes. Ejecuta en paralelo los seleccionados y
// devuelve los outcomes para que el worker persista el resultado en
// AutomationJob.result.

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
};

export async function runSelectedAgents(
  selection: string[], ctx: AgentContext, deps: AgentDeps,
): Promise<AgentOutcome[]> {
  const unique = Array.from(new Set(selection)).filter(t => AGENTS[t]);
  // Ejecutamos en paralelo pero capturamos errores individualmente para
  // que un fallo en un agente no cancele a los demás.
  const outcomes = await Promise.all(unique.map(async type => {
    try { return await AGENTS[type](ctx, deps); }
    catch (error) {
      return {
        type, created: 0, usedFallback: true, model: 'rule-based',
        errors: ['agent-crashed-' + (error instanceof Error ? error.message.slice(0, 120) : 'unknown')],
      } satisfies AgentOutcome;
    }
  }));
  return outcomes;
}

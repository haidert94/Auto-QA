// Orquestador de los agentes. Ejecuta en paralelo los seleccionados y
// devuelve los outcomes para que el worker persista el resultado en
// AutomationJob.result.

import { scenarioTestType } from '../document-generation';
import { isTestType, type AutomationTestType } from '../test-types';
import { outcomeIssue, type MissingGenerationRequirement } from '../generation-result';
import type { GeneratedCase } from '../generated-cases';
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

function agentContext(ctx: AgentContext, type: string, limit = true, initial = false): AgentContext {
  if (!ctx.documentTestTypesConfirmed) return ctx;
  const versionIds = ctx.documentGenerationSources && isTestType(type)
    ? new Set(ctx.documentGenerationSources[type]?.filter(source => !initial || !source.coverageOnly).map(source => source.versionId))
    : null;
  const requirements = (ctx.requirements ?? []).filter(requirement =>
    !versionIds || requirement.documentVersionIds?.some(id => versionIds.has(id)),
  );
  const pending = limit && ['functional_web', 'mobile_emulated', 'manual'].includes(type)
    ? requirements.filter(requirement => !requirement.scenarios?.some(scenario => scenarioTestType(scenario.tags) === type))
    : requirements;
  const specialized = type === 'mobile_emulated' || type === 'manual';
  const declared: typeof pending = [];
  const withoutCategory: typeof pending = [];
  for (const requirement of pending) {
    const versions = requirement.documentVersionIds?.filter(id => !versionIds || versionIds.has(id)) ?? [];
    const key = requirement.externalKey?.toUpperCase();
    const keys = specialized ? versions.flatMap(id => ctx.documentRequirementTypes?.[id]?.[type] ?? []) : [];
    if (key && keys.includes(key)) declared.push(requirement);
    else if (!keys.length) withoutCategory.push(requirement);
  }
  const applicable = specialized ? [...declared, ...withoutCategory] : pending;
  const missing = limit && (specialized || type === 'functional_web') ? applicable.slice(0, 20) : applicable;
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
  const outcomes = await Promise.all(unique.filter(type => type !== 'compatibility')
    .map(type => runAgent(type, agentContext(ctx, type), deps)));
  if (unique.includes('compatibility')) outcomes.push(await runAgent('compatibility', agentContext(ctx, 'compatibility'), deps));
  return outcomes;
}

async function runAgent(type: string, context: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  if (context.documentTestTypesConfirmed && !context.requirements?.length) {
    return { type, created: 0, usedFallback: false, model: 'not-called', errors: [] };
  }
  try {
    return await AGENTS[type](context, deps);
  } catch (error) {
    return {
      type, created: 0, usedFallback: true, model: 'rule-based',
      errors: ['agent-crashed-' + (error instanceof Error ? error.message.slice(0, 120) : 'unknown')],
    };
  }
}

const coverageOrder: AutomationTestType[] = ['functional_web', 'mobile_emulated', 'manual', 'availability', 'performance', 'ux', 'compatibility'];
const coverageBatchSize = 3;
const coverageConcurrency = 3;

export async function runDocumentAgents(
  selection: string[], ctx: AgentContext, deps: AgentDeps & { batch: GeneratedCase[] },
) {
  const selected = [...new Set(selection)].filter(isTestType);
  const versions = ctx.documentGenerationSources
    ? new Set(selected.flatMap(type => ctx.documentGenerationSources?.[type]?.map(source => source.versionId) ?? []))
    : null;
  const requirements = (ctx.requirements ?? []).filter(requirement =>
    !versions || requirement.documentVersionIds?.some(id => versions.has(id)),
  );
  const eligible = new Map(coverageOrder.filter(type => selected.includes(type)).map(type =>
    [type, new Set(agentContext(ctx, type, false).requirements?.map(requirement => requirement.id))],
  ));
  const requiredTypes = selected.filter(type => !ctx.documentGenerationSources?.[type]?.every(source => source.coverageOnly));
  const outcomes = new Map<string, AgentOutcome>();
  const failures = new Map<string, MissingGenerationRequirement>();
  const repairAttempted = new Set<AutomationTestType>();
  const blocked = new Map<AutomationTestType, 'ai-budget-exhausted' | 'no-environment'>();

  async function generate(type: AutomationTestType, context: AgentContext) {
    const outcome = await runAgent(type, context, deps);
    const issue = outcomeIssue(outcome.errors);
    if (issue === 'ai-budget-exhausted' || issue === 'no-environment') blocked.set(type, issue);
    const previous = outcomes.get(type);
    outcomes.set(type, previous ? {
      ...outcome,
      model: outcome.model === 'not-called' ? previous.model : outcome.model,
      created: previous.created + outcome.created,
      usedFallback: previous.usedFallback || outcome.usedFallback,
      errors: [...previous.errors, ...outcome.errors],
    } : outcome);
    return outcome;
  }

  function uncovered() {
    const staged = new Set(deps.batch.map(item => item.data.requirementId));
    return requirements.filter(requirement => !requirement.covered && !staged.has(requirement.id));
  }

  function agentFor(requirement: typeof requirements[number]) {
    const available = coverageOrder.filter(type => eligible.get(type)?.has(requirement.id));
    const key = requirement.externalKey?.toUpperCase() ?? '';
    const declaredType = available.find(type =>
      requirement.documentVersionIds?.some(id => ctx.documentRequirementTypes?.[id]?.[type]?.includes(key)));
    return declaredType ?? available[0];
  }

  async function repair(compatibility: boolean) {
    const groups = new Map<AutomationTestType, typeof requirements>();
    for (const requirement of uncovered()) {
      const type = agentFor(requirement);
      if (!type || (type === 'compatibility') !== compatibility) continue;
      const issue = blocked.get(type);
      if (issue) {
        const { id, title, externalKey } = requirement;
        failures.set(id, { id, title, externalKey, issue, type });
        continue;
      }
      const group = groups.get(type) ?? [];
      group.push(requirement);
      groups.set(type, group);
    }

    const tasks = [...groups].flatMap(([type, group]) => {
      repairAttempted.add(type);
      return Array.from({ length: Math.ceil(group.length / coverageBatchSize) }, (_, index) => ({
        type, requirements: group.slice(index * coverageBatchSize, (index + 1) * coverageBatchSize),
      }));
    });
    for (let offset = 0; offset < tasks.length; offset += coverageConcurrency) {
      await Promise.all(tasks.slice(offset, offset + coverageConcurrency).map(async task => {
        const context = { ...ctx, requirements: task.requirements, completingCoverage: true };
        const outcome = await generate(task.type, context);
        for (const { id, title, externalKey } of task.requirements) {
          failures.set(id, { id, title, externalKey, issue: outcomeIssue(outcome.errors), type: task.type });
        }
      }));
    }
  }

  const initial = (type: AutomationTestType) => generate(type, agentContext(ctx, type, true, true));
  const baseTypes = requiredTypes.filter(type => type !== 'compatibility');
  await Promise.all(baseTypes.map(initial));
  await repair(false);
  await repair(false);
  await Promise.all(baseTypes.filter(type => !outcomes.get(type)?.created && !repairAttempted.has(type)
    && !blocked.has(type) && outcomes.get(type)?.model !== 'not-called').map(initial));
  if (requiredTypes.includes('compatibility')) await initial('compatibility');
  await repair(true);

  return {
    outcomes: selected.map(type => outcomes.get(type) ?? { type, created: 0, model: 'not-called', usedFallback: false, errors: [] }),
    requiredTypes,
    scopedRequirements: requirements,
    coverage: {
      total: requirements.length,
      missing: uncovered().map(({ id, title, externalKey }): MissingGenerationRequirement => failures.get(id)
        ?? { id, title, externalKey, issue: 'no-cases' }),
    },
  };
}

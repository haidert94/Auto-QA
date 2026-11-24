import type { AgentOutcome } from './agents/agent-types';

export type GenerationIssue =
  | 'ai-budget-exhausted'
  | 'ai-unavailable'
  | 'invalid-agent-response'
  | 'no-base-scenarios'
  | 'no-environment'
  | 'missing-traceability'
  | 'missing-assertion'
  | 'no-cases'
  | 'agent-error'
  | 'coverage-changed';

export type GenerationSummary = {
  totalCreated: number;
  coverage?: { total: number; missing: MissingGenerationRequirement[] };
  outcomes: Array<Omit<AgentOutcome, 'errors'> & { errorCount: number; issue?: GenerationIssue }>;
};

export type MissingGenerationRequirement = {
  id: string;
  title: string;
  externalKey?: string | null;
  issue: GenerationIssue;
  type?: string;
};

export function outcomeIssue(errors: string[]): GenerationIssue {
  if (errors.includes('ai-budget-exhausted')) return 'ai-budget-exhausted';
  if (errors.includes('ai-unavailable')) return 'ai-unavailable';
  if (errors.includes('invalid-agent-response')) return 'invalid-agent-response';
  if (errors.includes('compatibility-no-linked-base')) return 'no-base-scenarios';
  if (errors.includes('no-environment-selected')) return 'no-environment';
  if (errors.some(error => /-sin-requisito(?:-verificable)?$/.test(error))) return 'missing-traceability';
  if (errors.some(error => /-sin-(?:asercion|resultado-esperado)$/.test(error))) return 'missing-assertion';
  return errors.length ? 'agent-error' : 'no-cases';
}

export function summarizeGeneration(outcomes: AgentOutcome[]): GenerationSummary {
  return {
    totalCreated: outcomes.reduce((total, outcome) => total + outcome.created, 0),
    outcomes: outcomes.map(({ errors, ...outcome }) => ({
      ...outcome,
      errorCount: errors.length,
      ...(outcome.created === 0 && outcome.model !== 'not-called' ? { issue: outcomeIssue(errors) } : {}),
    })),
  };
}

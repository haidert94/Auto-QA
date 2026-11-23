import type { AgentOutcome } from './agents/agent-types';

export type GenerationIssue =
  | 'ai-unavailable'
  | 'invalid-agent-response'
  | 'no-base-scenarios'
  | 'no-environment'
  | 'missing-traceability'
  | 'missing-assertion'
  | 'no-cases'
  | 'agent-error';

export type GenerationSummary = {
  totalCreated: number;
  outcomes: Array<Omit<AgentOutcome, 'errors'> & { errorCount: number; issue?: GenerationIssue }>;
};

function outcomeIssue(errors: string[]): GenerationIssue {
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
      ...(outcome.created === 0 ? { issue: outcomeIssue(errors) } : {}),
    })),
  };
}

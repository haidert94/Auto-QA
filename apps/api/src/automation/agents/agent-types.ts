// Tipos compartidos por los 6 agentes de generación. Cada agente recibe
// el contexto del AutomationJob (resultado del revisor + inputs del
// cliente) y devuelve un recuento de lo que creó.

import type { PrismaClient } from '@prisma/client';
import type { AiRouter } from '../../ai/ai-router';
import type { ReviewResult } from '../review-prompt';

export type AgentContext = {
  projectId: string;
  organizationId: string | null;
  jobId: string;
  runKey: string | null;
  environmentId: string | null;
  url: string;
  description: string | null;
  review: ReviewResult;
};

export type AgentOutcome = {
  type: string;
  created: number;
  usedFallback: boolean;
  model: string;
  errors: string[];
};

export type AgentDeps = {
  prisma: PrismaClient;
  router: AiRouter;
};

// Utilidad: extrae un JSON del texto devuelto por la IA. Admite tanto
// bloques "```json ...```" como JSON crudo.
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const brace = candidate.indexOf('{');
  const bracket = candidate.indexOf('[');
  const start = brace === -1 ? bracket : bracket === -1 ? brace : Math.min(brace, bracket);
  if (start < 0) return null;
  try {
    return JSON.parse(candidate.slice(start)) as T;
  } catch {
    try { return JSON.parse(candidate.slice(start, candidate.lastIndexOf(brace === start ? '}' : ']') + 1)) as T; }
    catch { return null; }
  }
}

export function storiesContext(review: ReviewResult): string {
  if (!review.stories.length) return '(sin historias detectadas)';
  return review.stories
    .filter(s => s.coverage !== 'no-cubierta')
    .slice(0, 20)
    .map(s => `- ${s.title} [${s.coverage}]`)
    .join('\n');
}

// Agente performance: crea PerformanceAudit (Lighthouse) y opcionalmente
// un LoadTest (k6) sobre URLs clave detectadas por la IA.

import type { Prisma } from '@prisma/client';
import { type AgentContext, type AgentDeps, type AgentOutcome, extractJson, generationResponseErrors, linkedRequirementId, LINKED_REQUIREMENT_INSTRUCTION, scenarioAnalysisContext } from './agent-types';

type Payload = {
  audits?: Array<{ requirementId?: string; url?: string }>;
  loadTests?: Array<{ requirementId?: string; name?: string; url?: string; profile?: 'suave' | 'medio' | 'intensivo' }>;
};

const PROFILES: Record<string, Array<{ duration: string; target: number }>> = {
  suave:      [{ duration: '30s', target: 5 },  { duration: '1m', target: 10 }, { duration: '30s', target: 0 }],
  medio:      [{ duration: '1m', target: 10 }, { duration: '3m', target: 30 }, { duration: '1m', target: 0 }],
  intensivo:  [{ duration: '2m', target: 20 }, { duration: '2m', target: 50 }, { duration: '5m', target: 100 }, { duration: '1m', target: 0 }],
};

export async function runPerformanceAgent(ctx: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  if (!ctx.environmentId) {
    return { type: 'performance', created: 0, usedFallback: true, model: 'rule-based',
      errors: ['no-environment-selected'] };
  }

  const prompt = [
    'Propone qué URLs auditar con Lighthouse y cuáles cargar con k6 para esta aplicación.',
    `URL base: ${ctx.url}`,
    ctx.description ? `Descripción: ${ctx.description}` : '',
    '',
    'Historias y requisitos analizados:',
    scenarioAnalysisContext(ctx),
    LINKED_REQUIREMENT_INSTRUCTION,
    '',
    'Devuelve SOLO JSON con dos arrays:',
    '{ "audits": [ { "requirementId": "id del requisito", "url": "https://..." } ], "loadTests": [ { "name": "pico mañana", "requirementId": "id del requisito", "url": "https://...", "profile": "suave|medio|intensivo" } ] }',
    'Máximo 3 audits y 2 loadTests. Si no estás seguro, deja loadTests vacío.',
  ].filter(Boolean).join('\n');

  const response = await deps.router.dispatch({
    operation: 'scenario-generation',
    organizationId: ctx.organizationId, projectId: ctx.projectId, runKey: ctx.runKey,
    prompt, systemPrompt: 'QA de performance. SOLO JSON.',
    maxOutputTokens: 800,
  });

  const parsed = extractJson<Payload>(response.text) ?? {};
  const audits = Array.isArray(parsed.audits) ? parsed.audits.slice(0, 3) : [];
  const loadTests = Array.isArray(parsed.loadTests) ? parsed.loadTests.slice(0, 2) : [];
  const errors = generationResponseErrors(response, Array.isArray(parsed.audits) || Array.isArray(parsed.loadTests));
  let created = 0;

  for (const [index, a] of audits.entries()) {
    const requirementId = linkedRequirementId(ctx, a?.requirementId);
    if (!requirementId) { errors.push('audit-' + index + '-sin-requisito'); continue; }
    const url = typeof a.url === 'string' ? a.url.trim() : '';
    if (!url) { errors.push('audit-' + index + '-sin-url'); continue; }
    try {
      await deps.prisma.performanceAudit.create({
        data: {
          projectId: ctx.projectId,
          environmentId: ctx.environmentId,
          requirementId,
          url: url.slice(0, 2048),
          status: 'QUEUED',
          createdByUserId: null,
        } as Prisma.PerformanceAuditUncheckedCreateInput,
      });
      created += 1;
    } catch (error) {
      errors.push('audit-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  for (const [index, lt] of loadTests.entries()) {
    const requirementId = linkedRequirementId(ctx, lt?.requirementId);
    if (!requirementId) { errors.push('load-' + index + '-sin-requisito'); continue; }
    const name = typeof lt.name === 'string' ? lt.name.trim() : '';
    const url = typeof lt.url === 'string' ? lt.url.trim() : '';
    const profile = lt.profile && PROFILES[lt.profile] ? lt.profile : 'suave';
    if (!name || !url) { errors.push('load-' + index + '-incompleto'); continue; }
    try {
      await deps.prisma.loadTest.create({
        data: {
          projectId: ctx.projectId,
          environmentId: ctx.environmentId,
          requirementId,
          name: name.slice(0, 120),
          url: url.slice(0, 2048),
          stages: PROFILES[profile] as unknown as Prisma.InputJsonValue,
          status: 'QUEUED',
        } as Prisma.LoadTestUncheckedCreateInput,
      });
      created += 1;
    } catch (error) {
      errors.push('load-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  return { type: 'performance', created, usedFallback: response.usedFallback ?? false, model: response.model, errors };
}

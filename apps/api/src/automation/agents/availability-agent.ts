// Agente disponibilidad: crea Monitor HTTP para las URLs críticas que la
// IA vincule con las historias y requisitos analizados.

import type { Prisma } from '@prisma/client';
import { type AgentContext, type AgentDeps, type AgentOutcome, generationResponseErrors, linkedRequirementId, LINKED_REQUIREMENT_INSTRUCTION, requestGeneration, scenarioAnalysisContext } from './agent-types';

type Payload = { monitors?: Array<{ requirementId?: string; name?: string; url?: string; intervalMinutes?: number }> };

export async function runAvailabilityAgent(ctx: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  if (!ctx.environmentId) {
    return { type: 'availability', created: 0, usedFallback: true, model: 'rule-based',
      errors: ['no-environment-selected'] };
  }

  const prompt = [
    'Dado el siguiente contexto, propone entre 2 y 5 URLs críticas para monitorizar con un check HTTP recurrente.',
    `URL base: ${ctx.url}`,
    ctx.description ? `Descripción: ${ctx.description}` : '',
    '',
    'Historias y requisitos analizados:',
    scenarioAnalysisContext(ctx),
    LINKED_REQUIREMENT_INSTRUCTION,
    '',
    'Devuelve SOLO JSON { "monitors": [ { "name": "Landing", "requirementId": "id del requisito", "url": "https://...", "intervalMinutes": 15 }, ... ] }.',
    'intervalMinutes entre 5 y 60. Los URL deben estar dentro del mismo dominio de la URL base.',
  ].filter(Boolean).join('\n');

  const { response, parsed } = await requestGeneration<Payload>(deps.router, {
    operation: 'scenario-generation',
    organizationId: ctx.organizationId, projectId: ctx.projectId, runKey: ctx.runKey,
    prompt, systemPrompt: 'QA SRE. SOLO JSON.',
    maxOutputTokens: 800,
  }, payload => Array.isArray(payload?.monitors));

  const monitors = Array.isArray(parsed?.monitors) ? parsed.monitors.slice(0, 5) : [];
  const errors = generationResponseErrors(response, parsed !== null);
  let created = 0;

  for (const [index, m] of monitors.entries()) {
    const name = typeof m?.name === 'string' ? m.name.trim() : '';
    const url = typeof m?.url === 'string' ? m.url.trim() : '';
    const requirementId = linkedRequirementId(ctx, m?.requirementId);
    if (!requirementId) { errors.push('monitor-' + index + '-sin-requisito'); continue; }
    if (!name || !url) { errors.push('monitor-' + index + '-incompleto'); continue; }
    const intervalMinutes = Math.min(Math.max(typeof m.intervalMinutes === 'number' ? m.intervalMinutes : 15, 5), 60);
    try {
      await deps.prisma.monitor.create({
        data: {
          projectId: ctx.projectId,
          environmentId: ctx.environmentId,
          requirementId,
          name: name.slice(0, 120),
          url: url.slice(0, 2048),
          intervalMinutes,
          timeoutMs: 10000,
          notifyEmails: [],
          createdByUserId: null,
        } as Prisma.MonitorUncheckedCreateInput,
      });
      created += 1;
    } catch (error) {
      errors.push('monitor-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  return { type: 'availability', created, usedFallback: response.usedFallback ?? false, model: response.model, errors };
}

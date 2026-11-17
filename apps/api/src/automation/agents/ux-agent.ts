// Agente UX: crea UxAudit rows (status=QUEUED) para que el worker UX
// las procese después. Decide qué URLs auditar a partir del contexto;
// el análisis real (Playwright + DOM a11y + IA) ocurre en ux-runner.ts.

import type { Prisma } from '@prisma/client';
import { type AgentContext, type AgentDeps, type AgentOutcome, extractJson, storiesContext } from './agent-types';

type Payload = { audits?: Array<{ url?: string }> };

export async function runUxAgent(ctx: AgentContext, deps: AgentDeps): Promise<AgentOutcome> {
  if (!ctx.environmentId) {
    return { type: 'ux', created: 0, usedFallback: true, model: 'rule-based',
      errors: ['no-environment-selected'] };
  }

  const prompt = [
    'Propone hasta 3 URLs representativas para auditar usabilidad y accesibilidad (heurísticas Nielsen + WCAG básico).',
    `URL base: ${ctx.url}`,
    ctx.description ? `Descripción: ${ctx.description}` : '',
    '',
    'Historias detectadas:',
    storiesContext(ctx.review),
    '',
    'Prioriza páginas con interacciones (login, checkout, formularios complejos).',
    'Responde SOLO JSON { "audits": [ { "url": "https://..." } ] }.',
  ].filter(Boolean).join('\n');

  const response = await deps.router.dispatch({
    operation: 'ux-analysis',
    organizationId: ctx.organizationId, projectId: ctx.projectId, runKey: ctx.runKey,
    prompt, systemPrompt: 'Experto en usabilidad y accesibilidad. SOLO JSON.',
    maxOutputTokens: 500,
  });

  const parsed = extractJson<Payload>(response.text) ?? {};
  const audits = Array.isArray(parsed.audits) ? parsed.audits.slice(0, 3) : [];
  const list = audits.length ? audits : [{ url: ctx.url }];
  const errors: string[] = [];
  let created = 0;

  for (const [index, a] of list.entries()) {
    const url = typeof a.url === 'string' ? a.url.trim() : '';
    if (!url) { errors.push('ux-' + index + '-sin-url'); continue; }
    try {
      await deps.prisma.uxAudit.create({
        data: {
          projectId: ctx.projectId,
          environmentId: ctx.environmentId,
          url: url.slice(0, 2048),
          status: 'QUEUED',
        } as Prisma.UxAuditUncheckedCreateInput,
      });
      created += 1;
    } catch (error) {
      errors.push('ux-' + index + '-' + (error instanceof Error ? error.message.slice(0, 80) : 'unknown'));
    }
  }

  return { type: 'ux', created, usedFallback: response.usedFallback ?? false, model: response.model, errors };
}

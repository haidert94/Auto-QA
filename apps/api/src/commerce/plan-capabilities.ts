import { ForbiddenException } from '@nestjs/common';
import type { CapabilityCode, PlanCapability, Prisma } from '@prisma/client';

export const planInclude = { capabilities: { orderBy: { position: 'asc' } } } satisfies Prisma.PlanInclude;
export type CatalogPlan = Prisma.PlanGetPayload<{ include: typeof planInclude }>;

// Runtime support is separate from the proposed entitlement stored in the catalog.
// Enable a code here only when its engine, worker and integration tests are ready.
// Ampliado el 2026-11-18 tras cablear el AiDocumentAnalyzer y verificar que
// cada agente (functional-web, mobile, compatibility, availability,
// performance, ux) + runners (Lighthouse, k6, ux-runner, ipa, icsp) y las
// operaciones IA (document-analysis, scenario-generation, failure-
// explanation, ux-analysis) están en producción. Una capability afuera de
// este set responde UPCOMING aunque el plan la venda como OPERATIONAL.
const implemented = new Set<CapabilityCode>([
  'DOCUMENT_ANALYSIS', 'IPA', 'ICSP', 'TRACEABILITY',
  'BROWSER_TESTS', 'RESPONSIVE_TESTS', 'CROSS_BROWSER',
  'LIGHTHOUSE_AUDITS', 'LOAD_TESTS', 'UPTIME_MONITORS',
  'AI_DOCUMENT_ANALYSIS', 'AI_SCENARIO_GENERATION',
  'AI_FAILURE_EXPLANATION', 'UX_ANALYSIS',
  'ADVANCED_REPORTS',
]);

export function availability(capability: Pick<PlanCapability, 'code' | 'availability'>) {
  return capability.availability === 'NOT_INCLUDED' || implemented.has(capability.code)
    ? capability.availability
    : 'UPCOMING';
}

export function runAvailability(plan: CatalogPlan) {
  const codes: CapabilityCode[] = ['BROWSER_TESTS', 'API_TESTS', 'PERFORMANCE_TESTS'];
  const states = plan.capabilities.filter(capability => codes.includes(capability.code)).map(availability);
  return (['OPERATIONAL', 'BETA', 'UPCOMING'] as const).find(state => states.includes(state)) ?? 'NOT_INCLUDED';
}

export function publicPlan(plan: CatalogPlan) {
  return {
    ...plan,
    runAvailability: runAvailability(plan),
    capabilities: plan.capabilities.map(capability => ({
      ...capability, availability: availability(capability),
    })),
  };
}

export function capabilityFor(plan: CatalogPlan, code: CapabilityCode) {
  return plan.capabilities.find(capability => capability.code === code);
}

export function requireCapability(plan: CatalogPlan, code: CapabilityCode) {
  const capability = capabilityFor(plan, code);
  if (!capability || availability(capability) === 'NOT_INCLUDED') {
    throw new ForbiddenException('Esta capacidad no está incluida en tu plan.');
  }
  if (availability(capability) === 'UPCOMING') {
    throw new ForbiddenException('Esta capacidad estará disponible próximamente.');
  }
  return capability;
}

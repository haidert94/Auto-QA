import type { Prisma } from '@prisma/client';
import type { AgentDeps } from './agents/agent-types';

export type GeneratedCase =
  | { kind: 'scenario'; data: Prisma.TestScenarioCreateManyInput }
  | { kind: 'monitor'; data: Prisma.MonitorCreateManyInput }
  | { kind: 'lighthouse'; data: Prisma.PerformanceAuditCreateManyInput }
  | { kind: 'load'; data: Prisma.LoadTestCreateManyInput }
  | { kind: 'ux'; data: Prisma.UxAuditCreateManyInput };

export async function saveGeneratedCase(prisma: AgentDeps['prisma'], candidate: GeneratedCase) {
  switch (candidate.kind) {
    case 'scenario': await prisma.testScenario.create({ data: candidate.data }); break;
    case 'monitor': await prisma.monitor.create({ data: candidate.data }); break;
    case 'lighthouse': await prisma.performanceAudit.create({ data: candidate.data }); break;
    case 'load': await prisma.loadTest.create({ data: candidate.data }); break;
    case 'ux': await prisma.uxAudit.create({ data: candidate.data }); break;
  }
}

export async function recordGeneratedCase(deps: AgentDeps, candidate: GeneratedCase) {
  if (deps.batch) {
    deps.batch.push(candidate);
    return;
  }
  await saveGeneratedCase(deps.prisma, candidate);
}

export async function saveGeneratedBatch(prisma: AgentDeps['prisma'], batch: GeneratedCase[]) {
  const scenarios = batch.filter(candidate => candidate.kind === 'scenario').map(candidate => candidate.data);
  const monitors = batch.filter(candidate => candidate.kind === 'monitor').map(candidate => candidate.data);
  const lighthouse = batch.filter(candidate => candidate.kind === 'lighthouse').map(candidate => candidate.data);
  const loadTests = batch.filter(candidate => candidate.kind === 'load').map(candidate => candidate.data);
  const ux = batch.filter(candidate => candidate.kind === 'ux').map(candidate => candidate.data);

  if (scenarios.length) await prisma.testScenario.createMany({ data: scenarios });
  if (monitors.length) await prisma.monitor.createMany({ data: monitors });
  if (lighthouse.length) await prisma.performanceAudit.createMany({ data: lighthouse });
  if (loadTests.length) await prisma.loadTest.createMany({ data: loadTests });
  if (ux.length) await prisma.uxAudit.createMany({ data: ux });
}

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

function modulePrefix(module: string) {
  const declaredCode = /^\[([\p{L}][\p{L}\p{N}]{0,7})\]/u.exec(module)?.[1]
    ?? /^([A-Z][A-Z0-9]{1,7})\s+[-–—]\s+/u.exec(module)?.[1];
  const prefix = (declaredCode ?? module).normalize('NFD').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  return declaredCode ? prefix : [...prefix].slice(0, 3).join('');
}

export async function saveGeneratedBatch(
  prisma: Prisma.TransactionClient,
  projectId: string,
  batch: GeneratedCase[],
  requirements: readonly { id: string; module?: string | null }[],
) {
  const prefixes = new Map(requirements.map(requirement => [requirement.id, modulePrefix(requirement.module ?? '')]));
  const byPrefix = new Map<string, GeneratedCase[]>();
  for (const candidate of batch) {
    const prefix = candidate.data.requirementId && prefixes.get(candidate.data.requirementId);
    if (!prefix) continue;
    const group = byPrefix.get(prefix) ?? [];
    group.push(candidate);
    byPrefix.set(prefix, group);
  }

  for (const [prefix, cases] of byPrefix) {
    const { lastOrdinal } = await prisma.scenarioModuleSequence.upsert({
      where: { projectId_prefix: { projectId, prefix } },
      create: { projectId, prefix, lastOrdinal: cases.length },
      update: { lastOrdinal: { increment: cases.length } },
      select: { lastOrdinal: true },
    });
    cases.forEach((candidate, index) => {
      const ordinal = lastOrdinal - cases.length + index + 1;
      candidate.data.caseCode = 'TC-' + prefix + '-' + String(ordinal).padStart(3, '0');
    });
  }

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

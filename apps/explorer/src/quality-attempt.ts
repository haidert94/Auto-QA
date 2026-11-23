import type { Prisma, PrismaClient, RunStatus } from '@prisma/client';
import { configuredUrlScope, validateExplorationUrl } from '../../api/src/exploration/url-guard';
import { RUN_CANCELED_BY_USER, RUN_STOP_REQUESTED } from '../../api/src/runs/run-cancellation';

type Kind = 'lighthouse' | 'load' | 'ux';
type Claim = { id: string; projectId: string; environmentId: string | null; url: string; runKey: string | null };

export function suiteAttempt(claim: Pick<Claim, 'runKey'>) {
  return claim.runKey?.startsWith('suite-') === true;
}

export function runnableQualityAttempt(claim: Claim) {
  return suiteAttempt(claim) ? {
    id: claim.id, runKey: claim.runKey, status: 'RUNNING' as const,
    OR: [{ errorCode: null }, { errorCode: { not: RUN_STOP_REQUESTED } }],
  } : { id: claim.id };
}

export async function withQualityStop<T>(requested: () => Promise<boolean>, run: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let reading = false;
  async function read() {
    if (reading || controller.signal.aborted) return;
    reading = true;
    try { if (await requested()) controller.abort(); }
    catch { /* A later poll can confirm the stop request. */ }
    finally { reading = false; }
  }
  await read();
  const timer = setInterval(() => void read(), 750);
  try { return await run(controller.signal); }
  finally { clearInterval(timer); }
}

type AttemptWhere = {
  id: string; runKey?: string | null; status?: RunStatus; errorCode?: string;
  OR?: Array<{ errorCode: null | { not: string } }>;
};
type AttemptData = { status: RunStatus; completedAt: Date; errorCode: string };

function useAttempt(db: Prisma.TransactionClient, kind: Kind) {
  const select = { errorCode: true } as const;
  switch (kind) {
    case 'lighthouse': return {
      read: (where: AttemptWhere) => db.performanceAudit.findFirst({ where, select }),
      update: (where: AttemptWhere, data: AttemptData) => db.performanceAudit.updateMany({ where, data }),
    };
    case 'load': return {
      read: (where: AttemptWhere) => db.loadTest.findFirst({ where, select }),
      update: (where: AttemptWhere, data: AttemptData) => db.loadTest.updateMany({ where, data }),
    };
    case 'ux': return {
      read: (where: AttemptWhere) => db.uxAudit.findFirst({ where, select }),
      update: (where: AttemptWhere, data: AttemptData) => db.uxAudit.updateMany({ where, data }),
    };
  }
}

export async function runQualityAttempt(
  prisma: PrismaClient, kind: Kind, claim: Claim, run: (signal?: AbortSignal) => Promise<void>,
) {
  if (!suiteAttempt(claim)) return run();

  const attempts = useAttempt(prisma, kind);
  const where = { id: claim.id, runKey: claim.runKey, status: 'RUNNING' as const };
  const startedAt = Date.now();
  try {
    await withQualityStop(async () => {
      const row = await attempts.read(where);
      return !row || row.errorCode === RUN_STOP_REQUESTED;
    }, async signal => {
      if (signal.aborted) return;
      const environment = claim.environmentId && await prisma.environment.findFirst({
        where: { id: claim.environmentId, projectId: claim.projectId },
        select: { authorizationConfirmed: true, readOnly: true, allowedHosts: true, allowedPaths: true, excludedPaths: true },
      });
      const authorized = environment && environment.authorizationConfirmed && (kind !== 'lighthouse' || environment.readOnly);
      const destination = authorized ? await validateExplorationUrl(claim.url, configuredUrlScope(claim.url, environment)) : null;
      if (!destination?.ok) {
        await attempts.update(runnableQualityAttempt(claim), { status: 'FAILED', completedAt: new Date(), errorCode: 'quality-scope-invalid' });
        return;
      }
      if (!signal.aborted) await run(signal);
    });
  } catch {
    await attempts.update(runnableQualityAttempt(claim), { status: 'FAILED', completedAt: new Date(), errorCode: 'quality-runner-error' });
  } finally {
    await prisma.$transaction(async tx => {
      await useAttempt(tx, kind).update({ ...where, errorCode: RUN_STOP_REQUESTED }, {
        status: 'CANCELED', completedAt: new Date(), errorCode: RUN_CANCELED_BY_USER,
      });
      if (claim.runKey) await tx.meteredRun.updateMany({
        where: { projectId: claim.projectId, runKey: claim.runKey, completedAt: null },
        data: { browserSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)), completedAt: new Date() },
      });
    });
  }
}

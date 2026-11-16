// Loop del worker: reclama una exploración QUEUED, la marca RUNNING y la
// ejecuta. Un solo worker a la vez por diseño en fase 5.3 (sin Redis);
// el lock pesimista garantiza que si hay varios workers no se pisan.

import { PrismaClient, type Prisma } from '@prisma/client';
import { runExploration } from './explorer';

export type ClaimedExploration = {
  id: string;
  projectId: string;
  environmentId: string;
  startUrl: string;
  limits: Prisma.JsonValue;
  runKey: string | null;
  createdByUserId: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorCode: string | null;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
};

export async function claimNext(prisma: PrismaClient): Promise<ClaimedExploration | null> {
  // SKIP LOCKED permite múltiples workers sin coordinación externa.
  const rows = await prisma.$queryRaw<ClaimedExploration[]>`
    UPDATE "Exploration"
    SET status = 'RUNNING', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "Exploration"
      WHERE status = 'QUEUED'
      ORDER BY "queuedAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, "projectId", "environmentId", "startUrl", limits, "runKey", "createdByUserId", "queuedAt", "startedAt", "finishedAt", "errorCode", status;
  `;
  return rows[0] ?? null;
}

export async function tick(prisma: PrismaClient): Promise<boolean> {
  const claim = await claimNext(prisma);
  if (!claim) return false;
  const environment = await prisma.environment.findUnique({
    where: { id: claim.environmentId },
    select: { allowedHosts: true, allowedPaths: true, excludedPaths: true },
  });
  if (!environment) {
    await prisma.exploration.update({
      where: { id: claim.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorCode: 'environment-missing' },
    });
    return true;
  }
  await runExploration(prisma, {
    id: claim.id,
    projectId: claim.projectId,
    environmentId: claim.environmentId,
    startUrl: claim.startUrl,
    limits: claim.limits,
    runKey: claim.runKey,
    createdByUserId: claim.createdByUserId,
    queuedAt: claim.queuedAt,
    startedAt: claim.startedAt,
    finishedAt: claim.finishedAt,
    errorCode: claim.errorCode,
    status: 'RUNNING',
  }, environment);
  return true;
}

export async function runLoop(prisma: PrismaClient, options: { pollIntervalMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  const poll = options.pollIntervalMs ?? 5000;
  while (!options.signal?.aborted) {
    const worked = await tick(prisma).catch(error => {
      console.error('[explorer] tick falló:', error);
      return false;
    });
    if (!worked) {
      await sleep(poll, options.signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

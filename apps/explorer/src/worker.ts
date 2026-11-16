// Loop del worker: reclama una exploración QUEUED, la marca RUNNING y la
// ejecuta. Un solo worker a la vez por diseño en fase 5.3 (sin Redis);
// el lock pesimista garantiza que si hay varios workers no se pisan.

import { PrismaClient, type Prisma } from '@prisma/client';
import { runAudit, type AuditClaim } from './audit-runner';
import { runExploration } from './explorer';
import { runTestRun, type ExecutionClaim } from './execution-runner';
import { tickMonitors } from './monitor-runner';
import { createScreenshotStorage } from './screenshot-storage';

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

export async function claimNextAudit(prisma: PrismaClient): Promise<AuditClaim | null> {
  const rows = await prisma.$queryRaw<AuditClaim[]>`
    UPDATE "PerformanceAudit"
    SET status = 'RUNNING', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "PerformanceAudit"
      WHERE status = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, "projectId", "environmentId", url, "runKey";
  `;
  return rows[0] ?? null;
}

export async function claimNextRun(prisma: PrismaClient): Promise<ExecutionClaim | null> {
  const rows = await prisma.$queryRaw<ExecutionClaim[]>`
    UPDATE "TestRun"
    SET status = 'RUNNING', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "TestRun"
      WHERE status = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, "projectId", "scenarioId", "environmentId", "runKey", "targetBrowser", "targetDevice";
  `;
  return rows[0] ?? null;
}

export async function tick(prisma: PrismaClient): Promise<boolean> {
  // Alternancia justa: primero una exploración, si no hay una ejecución.
  const explorationClaim = await claimNext(prisma);
  if (explorationClaim) {
    await runExplorationClaim(prisma, explorationClaim);
    return true;
  }
  const runClaim = await claimNextRun(prisma);
  if (runClaim) {
    const storage = createScreenshotStorage();
    await runTestRun(prisma, runClaim, storage, (level, detail) => {
      // Logs básicos; TestRun no tiene tabla de eventos todavía.
      console.log(`[run ${runClaim.id}] ${level}: ${detail}`);
    });
    return true;
  }
  const auditClaim = await claimNextAudit(prisma);
  if (auditClaim) {
    const storage = createScreenshotStorage();
    await runAudit(prisma, auditClaim, storage, (level, detail) => {
      console.log(`[audit ${auditClaim.id}] ${level}: ${detail}`);
    });
    return true;
  }
  // Monitores: no son una cola, son chequeos programados. Procesamos un
  // batch si hay alguno vencido. notify stub por ahora — el ticker llama
  // al correo si existe destinatario, pero si Mailpit no está no detiene
  // la ejecución (los logs lo registran).
  const checked = await tickMonitors(prisma, (level, detail) => {
    console.log(`[monitor] ${level}: ${detail}`);
  }, async () => { /* noop: el correo se envía desde el API en fases siguientes */ });
  if (checked > 0) return true;
  return false;
}

async function runExplorationClaim(prisma: PrismaClient, claim: ClaimedExploration): Promise<void> {
  const environment = await prisma.environment.findUnique({
    where: { id: claim.environmentId },
    select: { allowedHosts: true, allowedPaths: true, excludedPaths: true },
  });
  if (!environment) {
    await prisma.exploration.update({
      where: { id: claim.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorCode: 'environment-missing' },
    });
    return;
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

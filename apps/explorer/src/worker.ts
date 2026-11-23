// Loop del worker: reclama una exploración QUEUED, la marca RUNNING y la
// ejecuta. Un solo worker a la vez por diseño en fase 5.3 (sin Redis);
// el lock pesimista garantiza que si hay varios workers no se pisan.

import { PrismaClient, type Prisma } from '@prisma/client';
import { runAudit, type AuditClaim } from './audit-runner';
import { runAutomation, type AutomationClaim } from './automation-runner';
import { runExploration } from './explorer';
import { runTestRun, type ExecutionClaim } from './execution-runner';
import { runLoadTest, type LoadClaim } from './load-runner';
import { tickMonitors } from './monitor-runner';
import { runUxAudit, type UxAuditClaim } from './ux-runner';
import { runQualityAttempt } from './quality-attempt';
import { createScreenshotStorage } from './screenshot-storage';
import { AiRouter } from '../../api/src/ai/ai-router';
import { BudgetService } from '../../api/src/ai/budget.service';

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

export async function claimNextLoadTest(prisma: PrismaClient): Promise<LoadClaim | null> {
  const rows = await prisma.$queryRaw<LoadClaim[]>`
    UPDATE "LoadTest"
    SET status = 'RUNNING', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "LoadTest"
      WHERE status = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, "projectId", "environmentId", url, stages, "runKey";
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

export async function claimNextAutomation(prisma: PrismaClient): Promise<AutomationClaim | null> {
  // Preserva el stage previo en priorStage para que el runner decida
  // entre fase A (review) y fase C (generación). stage se actualiza a
  // 'claimed' solo si venía de 'pending' (primera vuelta).
  const rows = await prisma.$queryRaw<AutomationClaim[]>`
    UPDATE "AutomationJob" j
    SET status = 'RUNNING', "startedAt" = now(),
        stage = CASE WHEN j.stage = 'pending' THEN 'claimed' ELSE j.stage END
    FROM (
      SELECT id, stage AS "priorStage" FROM "AutomationJob"
      WHERE status = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) picked
    WHERE j.id = picked.id
    RETURNING j.id, j."projectId", j.inputs, j."runKey", picked."priorStage";
  `;
  return rows[0] ?? null;
}

export async function claimNextUxAudit(prisma: PrismaClient): Promise<UxAuditClaim | null> {
  const rows = await prisma.$queryRaw<UxAuditClaim[]>`
    UPDATE "UxAudit"
    SET status = 'RUNNING', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "UxAudit"
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
    RETURNING id, "projectId", "scenarioId", "environmentId", "runKey", "targetBrowser", "targetDevice", "targetProvider", "automation", "writeAuthorizationAt";
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
    await runQualityAttempt(prisma, 'lighthouse', auditClaim, signal => runAudit(prisma, auditClaim, storage, (level, detail) => {
      console.log(`[audit ${auditClaim.id}] ${level}: ${detail}`);
    }, signal));
    return true;
  }
  const loadClaim = await claimNextLoadTest(prisma);
  if (loadClaim) {
    const storage = createScreenshotStorage();
    await runQualityAttempt(prisma, 'load', loadClaim, signal => runLoadTest(prisma, loadClaim, storage, (level, detail) => {
      console.log(`[load ${loadClaim.id}] ${level}: ${detail}`);
    }, signal));
    return true;
  }
  // Automatización: pipeline convertir docs → revisar con IA, o fase de
  // generación según el priorStage.
  const automationClaim = await claimNextAutomation(prisma);
  if (automationClaim) {
    const router = buildAiRouter(prisma);
    await runAutomation(prisma, automationClaim, router, (level, detail) => {
      console.log(`[automation ${automationClaim.id}] ${level}: ${detail}`);
    });
    return true;
  }
  // Auditorías UX: creadas por el agente UX, procesadas aquí.
  const uxClaim = await claimNextUxAudit(prisma);
  if (uxClaim) {
    const storage = createScreenshotStorage();
    const router = buildAiRouter(prisma);
    await runQualityAttempt(prisma, 'ux', uxClaim, signal => runUxAudit(prisma, uxClaim, storage, router, (level, detail) => {
      console.log(`[ux ${uxClaim.id}] ${level}: ${detail}`);
    }, signal));
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

// Construye un AiRouter funcional usando la PrismaClient del worker.
// Reusa las clases del API sin pasar por el DI de NestJS.
function buildAiRouter(prisma: PrismaClient): AiRouter {
  const budget = new BudgetService(prisma as never);
  return new AiRouter(prisma as never, budget);
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

import type { Prisma } from '@prisma/client';
import { hasRole, type Workspace } from '../commerce/workspace.guard';
import { RUN_CANCELED_BY_USER, RUN_STOP_REQUESTED } from '../runs/run-cancellation';

export type QualityActivity = { status: string; errorCode: string | null; count: number; queuedAt: Date | null };

export function readQualitySuiteActivity(db: Prisma.TransactionClient, projectId: string) {
  return db.$queryRaw<QualityActivity[]>`
    SELECT status, "errorCode", count(*)::integer AS count, min("queuedAt") AS "queuedAt"
    FROM (
      SELECT status::text, "errorCode", NULL::timestamp AS "queuedAt"
      FROM "PerformanceAudit" WHERE "projectId" = ${projectId} AND "runKey" LIKE 'suite-%' AND status IN ('QUEUED', 'RUNNING')
      UNION ALL
      SELECT status::text, "errorCode", NULL::timestamp
      FROM "LoadTest" WHERE "projectId" = ${projectId} AND "runKey" LIKE 'suite-%' AND status IN ('QUEUED', 'RUNNING')
      UNION ALL
      SELECT status::text, "errorCode", NULL::timestamp
      FROM "UxAudit" WHERE "projectId" = ${projectId} AND "runKey" LIKE 'suite-%' AND status IN ('QUEUED', 'RUNNING')
      UNION ALL
      SELECT c.status, c."errorCode", c.at
      FROM "MonitorCheck" c JOIN "Monitor" m ON m.id = c."monitorId"
      WHERE m."projectId" = ${projectId} AND c.status IN ('QUEUED', 'RUNNING')
    ) attempts
    GROUP BY status, "errorCode"
  `;
}

export async function stopQualitySuiteAttempts(
  tx: Prisma.TransactionClient, projectId: string, workspace: Workspace, completedAt: Date,
) {
  const queued = { projectId, status: 'QUEUED' as const, runKey: { startsWith: 'suite-' } };
  const running = {
    ...queued, status: 'RUNNING' as const,
    OR: [{ errorCode: null }, { errorCode: { not: RUN_STOP_REQUESTED } }],
  };
  const canceled = { status: 'CANCELED' as const, errorCode: RUN_CANCELED_BY_USER };
  const stop = { errorCode: RUN_STOP_REQUESTED };
  const auditUpdate = { where: queued, data: { ...canceled, completedAt }, select: { runKey: true } } as const;
  const canStopLoad = !workspace.role || hasRole(workspace.role, ['ADMIN']);
  const queuedAudits = [
    ...await tx.performanceAudit.updateManyAndReturn(auditUpdate),
    ...await tx.uxAudit.updateManyAndReturn(auditUpdate),
    ...(canStopLoad ? await tx.loadTest.updateManyAndReturn(auditUpdate) : []),
  ];
  const queuedChecks = await tx.monitorCheck.updateMany({ where: { monitor: { projectId }, status: 'QUEUED' }, data: canceled });
  const activeAudits = await tx.performanceAudit.updateMany({ where: running, data: stop });
  const activeUx = await tx.uxAudit.updateMany({ where: running, data: stop });
  const activeLoad = canStopLoad ? await tx.loadTest.updateMany({ where: running, data: stop }) : { count: 0 };
  const activeChecks = await tx.monitorCheck.updateMany({
    where: { monitor: { projectId }, status: 'RUNNING', OR: running.OR }, data: stop,
  });
  return {
    queuedCanceled: queuedAudits.length + queuedChecks.count,
    runningRequested: activeAudits.count + activeUx.count + activeLoad.count + activeChecks.count,
    runKeys: queuedAudits.flatMap(run => run.runKey ? [run.runKey] : []),
  };
}

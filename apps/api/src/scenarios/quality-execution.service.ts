import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, RunStatus } from '@prisma/client';
import { projectScope, hasRole, type Workspace } from '../commerce/workspace.guard';
import { UsageService } from '../commerce/usage.service';
import { configuredUrlScope, validateExplorationUrlSync } from '../exploration/url-guard';
import { readLoadStages, totalLoadSeconds } from '../load/k6-summary';
import { PrismaService } from '../prisma.service';
import { qualityAutomationStatus, qualityTools, readQualityExecutionSource, type QualityKind } from './quality-automation';

type AuditKind = Exclude<QualityKind, 'availability'>;
type SourceId = { id: string; projectId: string };
type AttemptUpdate = {
  status?: RunStatus; startedAt?: Date | null; completedAt?: Date | null; runKey?: string;
  createdByUserId?: string | null; errorCode?: string | null;
};

const attemptSelect = { status: true, runKey: true, errorCode: true } as const;
const activeStatuses: RunStatus[] = ['QUEUED', 'RUNNING'];

function qualityKind(value: string) {
  if (!Object.hasOwn(qualityTools, value)) throw new NotFoundException('Tipo de prueba no encontrado.');
  return value as QualityKind;
}

function readAudit(tx: Prisma.TransactionClient, kind: AuditKind, where: SourceId) {
  switch (kind) {
    case 'lighthouse': return tx.performanceAudit.findFirst({ where, select: attemptSelect });
    case 'load': return tx.loadTest.findFirst({ where, select: attemptSelect });
    case 'ux': return tx.uxAudit.findFirst({ where, select: attemptSelect });
  }
}

function updateAudit(
  tx: Prisma.TransactionClient, kind: AuditKind,
  where: SourceId & { runKey?: string | null; status?: RunStatus }, data: AttemptUpdate,
) {
  // A new run replaces the latest metrics on the same scenario.
  const queued = data.status === 'QUEUED';
  switch (kind) {
    case 'lighthouse': return tx.performanceAudit.updateMany({
      where, data: { ...data, ...(queued && {
        reportKey: null, performanceScore: null, accessibilityScore: null, bestPracticesScore: null,
        seoScore: null, fcpMs: null, lcpMs: null, tbtMs: null, cls: null, siMs: null,
      }) },
    });
    case 'load': return tx.loadTest.updateMany({
      where, data: { ...data, ...(queued && {
        summaryKey: null, totalRequests: null, reqPerSec: null, failRate: null,
        p50Ms: null, p95Ms: null, p99Ms: null, maxVus: null, durationSec: null,
      }) },
    });
    case 'ux': return tx.uxAudit.updateMany({
      where, data: { ...data, ...(queued && {
        reportKey: null, totalFindings: null, criticalCount: null, majorCount: null, minorCount: null,
      }) },
    });
  }
}

function attemptedMonitor(tx: Prisma.TransactionClient, monitor: SourceId, attemptId: string) {
  return tx.monitorCheck.findFirst({
    where: { id: attemptId, monitorId: monitor.id, monitor },
    select: { status: true, errorCode: true },
  });
}

function monitorResult(id: string, check: { status: string; errorCode: string | null }) {
  const status = check.status === 'UP' ? 'COMPLETED' : check.status === 'DOWN' ? 'FAILED' : check.status;
  return { id, status, errorCode: check.errorCode, passed: check.status === 'UP' };
}

@Injectable()
export class QualityExecutionService {
  constructor(private readonly prisma: PrismaService, private readonly usage: UsageService) {}

  async queue(projectId: string, resourceId: string, rawKind: string, id: string, workspace: Workspace) {
    const kind = qualityKind(rawKind);
    if (kind === 'load' && workspace.role && !hasRole(workspace.role, ['ADMIN'])) {
      throw new ForbiddenException('Tu rol no permite iniciar pruebas de carga.');
    }
    const where = { projectId, id: resourceId };
    return this.prisma.$transaction(async tx => {
      const project = await tx.project.findFirst({
        where: { id: projectId, ...projectScope(workspace), status: 'READY' }, select: { id: true },
      });
      if (!project) throw new NotFoundException('Proyecto no disponible para ejecución.');
      const runKey = 'suite-' + id;
      const previous = kind === 'availability' ? await attemptedMonitor(tx, where, id) : await readAudit(tx, kind, where);
      if (previous && (kind === 'availability' || 'runKey' in previous && previous.runKey === runKey)) {
        return kind === 'availability' ? monitorResult(id, previous) : { id, status: previous.status, errorCode: previous.errorCode };
      }
      const source = await readQualityExecutionSource(tx, kind, where);
      if (!source) throw new NotFoundException('Prueba no encontrada.');
      if (!qualityAutomationStatus(kind, source).prepared) {
        throw new BadRequestException('Genera el código de esta prueba con su configuración autorizada antes de ejecutarla.');
      }
      if (!source.environmentId || !source.environment?.authorizationConfirmed) {
        throw new BadRequestException('La prueba requiere un entorno autorizado.');
      }
      if (!validateExplorationUrlSync(source.url, configuredUrlScope(source.url, source.environment)).ok) {
        throw new BadRequestException('El destino de la prueba está fuera del alcance autorizado.');
      }
      if (kind === 'lighthouse' && !source.environment.readOnly) {
        throw new BadRequestException('La medición de rendimiento requiere un entorno de solo lectura.');
      }

      if (kind === 'availability') {
        // One requested check per monitor, even if two suites submit at once.
        const [monitor] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Monitor" WHERE id = ${resourceId} AND "projectId" = ${projectId} FOR UPDATE
        `;
        if (!monitor) throw new NotFoundException('Monitor no encontrado.');
        const check = await attemptedMonitor(tx, where, id);
        if (check) return monitorResult(id, check);
        const inProgress = await tx.monitorCheck.findFirst({
          where: { monitorId: resourceId, status: { in: activeStatuses } }, select: { id: true },
        });
        if (inProgress) throw new ConflictException('Esta prueba ya está en cola o en ejecución.');
        await tx.monitorCheck.create({ data: { id, monitorId: resourceId, status: 'QUEUED' } });
      } else {
        const audit = await readAudit(tx, kind, where);
        if (!audit) throw new NotFoundException('Prueba no encontrada.');
        if (audit.runKey === runKey) return { id, status: audit.status, errorCode: audit.errorCode };
        if (activeStatuses.includes(audit.status)) throw new ConflictException('Esta prueba ya está en cola o en ejecución.');

        let seconds = 90;
        if (kind === 'load') {
          const stages = readLoadStages(source.stages);
          seconds = stages ? totalLoadSeconds(stages) : 0;
          if (!stages || seconds < 10 || seconds > 1800 || !stages.some(stage => stage.target > 0)) {
            throw new BadRequestException('La prueba de carga requiere un perfil válido.');
          }
        }
        if (workspace.organizationId) {
          await this.usage.reserveRun(workspace.organizationId, projectId, runKey, {
            kind: 'BROWSER', browser: 'CHROMIUM', browserSeconds: seconds,
          }, tx);
        }
        const updated = await updateAudit(tx, kind, { ...where, status: audit.status, runKey: audit.runKey }, {
          status: 'QUEUED', runKey, startedAt: null, completedAt: null, errorCode: null,
          createdByUserId: workspace.userId ?? null,
        });
        if (!updated.count) throw new ConflictException('Esta prueba cambió. Consulta el estado antes de volver a ejecutarla.');
      }
      return { id, status: 'QUEUED' };
    });
  }

  async status(projectId: string, resourceId: string, rawKind: string, id: string) {
    const kind = qualityKind(rawKind);
    const where = { projectId, id: resourceId };
    if (kind === 'availability') {
      const check = await attemptedMonitor(this.prisma, where, id);
      if (check) return monitorResult(id, check);
    } else {
      const audit = await readAudit(this.prisma, kind, where);
      if (audit?.runKey === 'suite-' + id) return { id, status: audit.status, errorCode: audit.errorCode };
    }
    throw new NotFoundException('Ejecución no encontrada.');
  }

}

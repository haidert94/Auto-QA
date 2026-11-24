import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RunStatus } from '@prisma/client';
import { projectScope, hasRole, type Workspace } from '../commerce/workspace.guard';
import { AiRouter } from '../ai/ai-router';
import { UsageService } from '../commerce/usage.service';
import { configuredUrlScope, validateExplorationUrlSync } from '../exploration/url-guard';
import { readLoadStages, totalLoadSeconds } from '../load/k6-summary';
import { PrismaService } from '../prisma.service';
import { authorizedTarget, qualityAutomationSource, qualityAutomationStatus, qualityConfigurationSignature, qualityTools, readQualityExecutionSource, renderQualityConfiguration, type QualityKind } from './quality-automation';
import { QualityReviewRequired } from './quality-agents/agent-context';
import { readQualityScenarios } from './quality-scenarios';
import type { QualityConfigurationDto } from './dto/quality-configuration.dto';

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
  where: SourceId & { runKey?: string | null; status?: RunStatus; automationSignature?: string | null }, data: AttemptUpdate,
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
        reportKey: null, reportDetails: Prisma.DbNull, screenshotKey: null,
        totalFindings: null, criticalCount: null, majorCount: null, minorCount: null,
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

async function lockMonitor(tx: Prisma.TransactionClient, where: SourceId) {
  const [monitor] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Monitor" WHERE id = ${where.id} AND "projectId" = ${where.projectId} FOR UPDATE
  `;
  if (!monitor) throw new NotFoundException('Monitor no encontrado.');
}

async function requireReadyProject(db: Prisma.TransactionClient, projectId: string, workspace: Workspace) {
  const project = await db.project.findFirst({
    where: { id: projectId, ...projectScope(workspace), status: 'READY' }, select: { id: true },
  });
  if (!project) throw new NotFoundException('Proyecto no disponible para ejecución.');
}

@Injectable()
export class QualityExecutionService {
  constructor(private readonly prisma: PrismaService, private readonly usage: UsageService, private readonly ai: AiRouter) {}

  async configure(projectId: string, resourceId: string, rawKind: string, dto: QualityConfigurationDto, workspace: Workspace) {
    const kind = qualityKind(rawKind);
    if (kind === 'load' && workspace.role && !hasRole(workspace.role, ['ADMIN'])) {
      throw new ForbiddenException('Tu rol no permite configurar pruebas de carga.');
    }
    const monitorSettings = [dto.active, dto.intervalMinutes, dto.timeoutMs, dto.method, dto.minStatus, dto.maxStatus];
    if ((kind !== 'availability' && monitorSettings.some(value => value !== undefined))
        || (kind !== 'load' && dto.stages !== undefined)) {
      throw new BadRequestException('La configuración no corresponde al tipo de prueba.');
    }
    await requireReadyProject(this.prisma, projectId, workspace);
    const where = { id: resourceId, projectId };
    const source = await readQualityExecutionSource(this.prisma, kind, where);
    if (!source) throw new NotFoundException('Prueba no encontrada.');
    const environment = await this.prisma.environment.findFirst({
      where: { id: dto.environmentId, projectId }, select: qualityAutomationSource.environment.select,
    });
    if (kind === 'lighthouse' && environment?.readOnly === false) {
      throw new BadRequestException('La medición de rendimiento requiere un entorno de solo lectura.');
    }

    const signature = qualityConfigurationSignature(kind, source);
    const stages = dto.stages?.map(({ duration, target }) => ({ duration, target }));
    const next = {
      ...source, environment, environmentId: dto.environmentId, url: dto.url?.trim() ?? source.url,
      intervalMinutes: dto.intervalMinutes ?? source.intervalMinutes, timeoutMs: dto.timeoutMs ?? source.timeoutMs,
      stages: stages ?? source.stages,
      method: dto.method ?? source.method,
      minStatus: dto.minStatus ?? source.minStatus,
      maxStatus: dto.maxStatus ?? source.maxStatus,
    };
    const preparation = await (async () => {
      try {
        const target = authorizedTarget(next);
        if (dto.url !== undefined) next.url = target.toString();
        if (qualityConfigurationSignature(kind, next) === signature && qualityAutomationStatus(kind, source).prepared) return {};
        return await renderQualityConfiguration(kind, next, target, { ai: this.ai, organizationId: workspace.organizationId, projectId });
      } catch (error) {
        if (error instanceof QualityReviewRequired) throw new BadRequestException(error.message);
        throw error;
      }
    })();

    return this.prisma.$transaction(async tx => {
      await requireReadyProject(tx, projectId, workspace);
      if (kind === 'availability') await lockMonitor(tx, where);

      const audit = kind === 'availability' ? null : await readAudit(tx, kind, where);
      const running = kind === 'availability'
        ? await tx.monitorCheck.findFirst({ where: { monitorId: resourceId, status: { in: activeStatuses } }, select: { id: true } })
        : audit && activeStatuses.includes(audit.status);
      if (running) throw new ConflictException('Espera a que termine la ejecución antes de editar su configuración.');
      const current = await readQualityExecutionSource(tx, kind, where);
      if (!current || qualityConfigurationSignature(kind, current) !== signature || current.active !== source.active) {
        throw new ConflictException('La configuración cambió. Vuelve a abrir la suite.');
      }
      const authorizedEnvironment = await tx.environment.findFirst({
        where: { id: dto.environmentId, projectId }, select: qualityAutomationSource.environment.select,
      });
      if (JSON.stringify(authorizedEnvironment) !== JSON.stringify(environment)) {
        throw new ConflictException('La autorización del entorno cambió. Revisa su configuración.');
      }

      const criteria = { ...where, automationSignature: current.automationSignature, requirement: { is: { projectId } } };
      const data = { environmentId: next.environmentId, url: next.url, ...preparation };
      let updated;
      if (kind === 'availability') {
        updated = await tx.monitor.updateMany({ where: criteria, data: {
          ...data, intervalMinutes: dto.intervalMinutes, timeoutMs: dto.timeoutMs, active: dto.active,
          method: dto.method, minStatus: dto.minStatus, maxStatus: dto.maxStatus,
        } });
      } else {
        const filter = { ...criteria, status: { notIn: activeStatuses } };
        switch (kind) {
          case 'lighthouse': updated = await tx.performanceAudit.updateMany({ where: filter, data }); break;
          case 'load': updated = await tx.loadTest.updateMany({ where: filter, data: { ...data, stages } }); break;
          case 'ux': updated = await tx.uxAudit.updateMany({ where: filter, data }); break;
        }
      }
      if (!updated.count) throw new ConflictException('La prueba cambió. Vuelve a abrir la suite.');
      const saved = (await readQualityScenarios(tx, projectId, resourceId)).find(item => item.quality.kind === kind);
      if (!saved) throw new NotFoundException('Prueba no encontrada.');
      return saved;
    });
  }

  async queue(projectId: string, resourceId: string, rawKind: string, id: string, workspace: Workspace) {
    const kind = qualityKind(rawKind);
    if (kind === 'load' && workspace.role && !hasRole(workspace.role, ['ADMIN'])) {
      throw new ForbiddenException('Tu rol no permite iniciar pruebas de carga.');
    }
    const where = { projectId, id: resourceId };
    return this.prisma.$transaction(async tx => {
      await requireReadyProject(tx, projectId, workspace);
      if (kind === 'availability') await lockMonitor(tx, where);
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
        const updated = await updateAudit(tx, kind, {
          ...where, status: audit.status, runKey: audit.runKey, automationSignature: source.automationSignature,
        }, {
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

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { UsageService } from '../commerce/usage.service';
import type { Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { SCREENSHOT_READER, type ScreenshotReader } from '../exploration/screenshot-storage';
import { validateExplorationUrlSync, type GuardScope } from '../exploration/url-guard';
import { CreateAuditDto } from './dto/create-audit.dto';

function scopeFromEnvironment(env: { allowedHosts: Prisma.JsonValue; allowedPaths: Prisma.JsonValue; excludedPaths: Prisma.JsonValue }): GuardScope {
  const toStringArray = (value: Prisma.JsonValue): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    allowedHosts: toStringArray(env.allowedHosts),
    allowedPaths: toStringArray(env.allowedPaths),
    excludedPaths: toStringArray(env.excludedPaths),
  };
}

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(SCREENSHOT_READER) private readonly storage: ScreenshotReader,
  ) {}

  async list(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.performanceAudit.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, url: true, status: true, errorCode: true,
        startedAt: true, completedAt: true, createdAt: true,
        performanceScore: true, accessibilityScore: true,
        bestPracticesScore: true, seoScore: true,
        fcpMs: true, lcpMs: true, tbtMs: true, cls: true, siMs: true,
      },
    });
  }

  async get(projectId: string, auditId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const audit = await this.prisma.performanceAudit.findFirst({
      where: { id: auditId, projectId },
      include: { environment: { select: { id: true, baseUrl: true, type: true } } },
    });
    if (!audit) throw new NotFoundException('Auditoría no encontrada.');
    return audit;
  }

  async create(projectId: string, dto: CreateAuditDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const environment = await this.prisma.environment.findFirst({
      where: { id: dto.environmentId, projectId },
    });
    if (!environment) throw new NotFoundException('Entorno no encontrado.');
    if (!environment.authorizationConfirmed) {
      throw new BadRequestException('Confirma la autorización del entorno antes de auditarlo.');
    }
    if (!environment.readOnly) {
      throw new BadRequestException('Solo se audita en entornos de solo lectura.');
    }

    const scope = scopeFromEnvironment(environment);
    const guard = validateExplorationUrlSync(dto.url, scope);
    if (!guard.ok) {
      throw new BadRequestException({
        issue: guard.issue, detail: guard.detail,
        message: 'La URL no pasó las validaciones de alcance.',
      });
    }

    const runKey = workspace.organizationId ? 'audit-' + randomUUID() : null;
    if (workspace.organizationId && runKey) {
      // Presupuesto defensivo de 90 s de navegador por audit; el worker
      // liquida el consumo real al terminar.
      await this.usage.reserveRun(workspace.organizationId, projectId, runKey, {
        kind: 'BROWSER', browser: 'CHROMIUM', browserSeconds: 90,
      });
    }

    return this.prisma.performanceAudit.create({
      data: {
        projectId,
        environmentId: environment.id,
        url: guard.url.toString(),
        status: 'QUEUED',
        runKey,
        createdByUserId: workspace.userId ?? null,
      },
      select: { id: true, status: true, url: true, createdAt: true, runKey: true },
    });
  }

  async report(projectId: string, auditId: string, workspace: Workspace): Promise<Buffer> {
    await this.ensureProject(projectId, workspace);
    const audit = await this.prisma.performanceAudit.findFirst({
      where: { id: auditId, projectId },
      select: { reportKey: true },
    });
    if (!audit) throw new NotFoundException('Auditoría no encontrada.');
    if (!audit.reportKey) throw new NotFoundException('Esta auditoría no tiene reporte almacenado.');
    const bytes = await this.storage.read(audit.reportKey);
    if (!bytes) throw new NotFoundException('Reporte no disponible en el almacenamiento.');
    return bytes;
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...workspace }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

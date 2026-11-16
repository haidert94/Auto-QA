import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { UsageService } from '../commerce/usage.service';
import type { Workspace } from '../commerce/workspace.guard';
import { diffExplorations } from '../common/diffs';
import { PrismaService } from '../prisma.service';
import { CreateExplorationDto, ExplorationLimitsDto } from './dto/create-exploration.dto';
import { SCREENSHOT_READER, type ScreenshotReader } from './screenshot-storage';
import { validateExplorationUrlSync, type GuardScope } from './url-guard';

const EXPLORATION_REUSE_MINUTES = Math.min(Math.max(
  Number(process.env.AUTOQA_EXPLORATION_REUSE_MINUTES ?? '15'), 1), 24 * 60);

const DEFAULT_LIMITS = {
  maxPages: 20,
  perNavigationTimeoutSeconds: 30,
  totalBudgetSeconds: 120,
  maxResponseBytes: 5_000_000,
};

function scopeFromEnvironment(env: { allowedHosts: Prisma.JsonValue; allowedPaths: Prisma.JsonValue; excludedPaths: Prisma.JsonValue }): GuardScope {
  const toStringArray = (value: Prisma.JsonValue): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    allowedHosts: toStringArray(env.allowedHosts),
    allowedPaths: toStringArray(env.allowedPaths),
    excludedPaths: toStringArray(env.excludedPaths),
  };
}

function mergeLimits(provided?: ExplorationLimitsDto) {
  return { ...DEFAULT_LIMITS, ...(provided ?? {}) };
}

@Injectable()
export class ExplorationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(SCREENSHOT_READER) private readonly screenshots: ScreenshotReader,
  ) {}

  async screenshot(projectId: string, explorationId: string, pageId: string, workspace: Workspace): Promise<Buffer> {
    await this.ensureProject(projectId, workspace);
    const page = await this.prisma.explorationPage.findFirst({
      where: { id: pageId, explorationId, exploration: { projectId } },
      select: { screenshotKey: true },
    });
    if (!page) throw new NotFoundException('Página de exploración no encontrada.');
    if (!page.screenshotKey) throw new NotFoundException('Esta página no tiene captura asociada.');
    const bytes = await this.screenshots.read(page.screenshotKey);
    if (!bytes) throw new NotFoundException('Captura no disponible en el almacenamiento.');
    return bytes;
  }

  async list(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.exploration.findMany({
      where: { projectId },
      orderBy: { queuedAt: 'desc' },
      select: {
        id: true, status: true, startUrl: true, environmentId: true,
        queuedAt: true, startedAt: true, finishedAt: true, errorCode: true,
      },
    });
  }

  async get(projectId: string, explorationId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const exploration = await this.prisma.exploration.findFirst({
      where: { id: explorationId, projectId },
      include: {
        pages: { orderBy: { position: 'asc' } },
        logs: { orderBy: { at: 'asc' } },
      },
    });
    if (!exploration) throw new NotFoundException('Exploración no encontrada.');
    return exploration;
  }

  async create(projectId: string, dto: CreateExplorationDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const environment = await this.prisma.environment.findFirst({
      where: { id: dto.environmentId, projectId },
    });
    if (!environment) throw new NotFoundException('Entorno no encontrado en este proyecto.');
    if (!environment.authorizationConfirmed) {
      throw new BadRequestException('Confirma la autorización del entorno antes de explorarlo.');
    }
    if (!environment.readOnly) {
      throw new BadRequestException('La exploración de fase 5 solo se permite en entornos de solo lectura.');
    }

    const scope = scopeFromEnvironment(environment);
    const guard = validateExplorationUrlSync(dto.startUrl, scope);
    if (!guard.ok) {
      throw new BadRequestException({ issue: guard.issue, detail: guard.detail, message: 'La URL no pasó las validaciones de exploración.' });
    }

    const canonicalUrl = guard.url.toString();
    if (!dto.force) {
      const reusable = await this.findReusableExploration(projectId, environment.id, canonicalUrl);
      if (reusable) {
        throw new ConflictException({
          message: 'Hay una exploración reciente para la misma URL. Reutilízala o pasa force: true.',
          reused: true,
          explorationId: reusable.id,
          finishedAt: reusable.finishedAt,
          reuseWindowMinutes: EXPLORATION_REUSE_MINUTES,
        });
      }
    }

    const limits = mergeLimits(dto.limits);
    const runKey = workspace.organizationId ? 'exp-' + randomUUID() : null;
    if (workspace.organizationId && runKey) {
      await this.usage.reserveRun(workspace.organizationId, projectId, runKey, {
        kind: 'BROWSER', browser: 'CHROMIUM', browserSeconds: limits.totalBudgetSeconds,
      });
    }

    return this.prisma.exploration.create({
      data: {
        projectId,
        environmentId: environment.id,
        startUrl: canonicalUrl,
        limits: limits as unknown as Prisma.InputJsonValue,
        status: 'QUEUED',
        runKey,
        createdByUserId: workspace.userId ?? null,
      },
      select: { id: true, status: true, startUrl: true, environmentId: true, queuedAt: true, limits: true, runKey: true },
    });
  }

  async diff(projectId: string, explorationId: string, previousId: string | null, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const current = await this.prisma.exploration.findFirst({
      where: { id: explorationId, projectId },
      select: { id: true, environmentId: true, startUrl: true, finishedAt: true,
        pages: { select: { url: true, httpStatus: true } } },
    });
    if (!current) throw new NotFoundException('Exploración no encontrada.');

    let previous: typeof current | null = null;
    if (previousId) {
      previous = await this.prisma.exploration.findFirst({
        where: { id: previousId, projectId },
        select: { id: true, environmentId: true, startUrl: true, finishedAt: true,
          pages: { select: { url: true, httpStatus: true } } },
      });
      if (!previous) throw new NotFoundException('Exploración de comparación no encontrada.');
    } else {
      // Predeterminado: la exploración COMPLETED anterior más reciente contra
      // el mismo entorno y URL de inicio.
      previous = await this.prisma.exploration.findFirst({
        where: {
          projectId, environmentId: current.environmentId, startUrl: current.startUrl,
          status: 'COMPLETED', NOT: { id: current.id },
          finishedAt: current.finishedAt ? { lt: current.finishedAt } : undefined,
        },
        orderBy: { finishedAt: 'desc' },
        select: { id: true, environmentId: true, startUrl: true, finishedAt: true,
          pages: { select: { url: true, httpStatus: true } } },
      });
    }

    return {
      previous: previous ? { id: previous.id, finishedAt: previous.finishedAt } : null,
      current: { id: current.id, finishedAt: current.finishedAt },
      diff: diffExplorations(previous?.pages ?? [], current.pages),
    };
  }

  // Devuelve una exploración recientemente completada reutilizable, o null.
  private async findReusableExploration(projectId: string, environmentId: string, startUrl: string) {
    const cutoff = new Date(Date.now() - EXPLORATION_REUSE_MINUTES * 60 * 1000);
    return this.prisma.exploration.findFirst({
      where: { projectId, environmentId, startUrl, status: 'COMPLETED', finishedAt: { gt: cutoff } },
      orderBy: { finishedAt: 'desc' },
      select: { id: true, finishedAt: true },
    });
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...workspace }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

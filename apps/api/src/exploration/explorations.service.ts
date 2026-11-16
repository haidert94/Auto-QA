import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { CreateExplorationDto, ExplorationLimitsDto } from './dto/create-exploration.dto';
import { validateExplorationUrlSync, type GuardScope } from './url-guard';

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
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.exploration.create({
      data: {
        projectId,
        environmentId: environment.id,
        startUrl: guard.url.toString(),
        limits: mergeLimits(dto.limits) as unknown as Prisma.InputJsonValue,
        status: 'QUEUED',
      },
      select: { id: true, status: true, startUrl: true, environmentId: true, queuedAt: true, limits: true },
    });
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...workspace }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

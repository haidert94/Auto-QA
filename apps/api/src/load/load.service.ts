import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { UsageService } from '../commerce/usage.service';
import type { Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { SCREENSHOT_READER, type ScreenshotReader } from '../exploration/screenshot-storage';
import { validateExplorationUrlSync, type GuardScope } from '../exploration/url-guard';
import { CreateLoadTestDto } from './dto/create-load-test.dto';

function scopeFromEnvironment(env: { allowedHosts: Prisma.JsonValue; allowedPaths: Prisma.JsonValue; excludedPaths: Prisma.JsonValue }): GuardScope {
  const toStringArray = (value: Prisma.JsonValue): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    allowedHosts: toStringArray(env.allowedHosts),
    allowedPaths: toStringArray(env.allowedPaths),
    excludedPaths: toStringArray(env.excludedPaths),
  };
}

function totalSeconds(stages: { duration: string }[]): number {
  return stages.reduce((sum, s) => {
    const match = /^(\d+)([smh])$/.exec(s.duration);
    if (!match) return sum;
    const value = Number(match[1]);
    const mult = match[2] === 'h' ? 3600 : match[2] === 'm' ? 60 : 1;
    return sum + value * mult;
  }, 0);
}

@Injectable()
export class LoadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(SCREENSHOT_READER) private readonly storage: ScreenshotReader,
  ) {}

  async list(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.loadTest.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, name: true, url: true, status: true, errorCode: true,
        stages: true, startedAt: true, completedAt: true, createdAt: true,
        totalRequests: true, reqPerSec: true, failRate: true,
        p50Ms: true, p95Ms: true, p99Ms: true, maxVus: true, durationSec: true,
      },
    });
  }

  async get(projectId: string, loadTestId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const row = await this.prisma.loadTest.findFirst({
      where: { id: loadTestId, projectId },
      include: { environment: { select: { id: true, baseUrl: true, type: true } } },
    });
    if (!row) throw new NotFoundException('Prueba de carga no encontrada.');
    return row;
  }

  async create(projectId: string, dto: CreateLoadTestDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const environment = await this.prisma.environment.findFirst({
      where: { id: dto.environmentId, projectId },
    });
    if (!environment) throw new NotFoundException('Entorno no encontrado.');
    if (!environment.authorizationConfirmed) {
      throw new BadRequestException('Confirma la autorización del entorno antes de ejecutar pruebas de carga.');
    }

    const scope = scopeFromEnvironment(environment);
    const guard = validateExplorationUrlSync(dto.url, scope);
    if (!guard.ok) {
      throw new BadRequestException({ issue: guard.issue, detail: guard.detail,
        message: 'La URL no pasó las validaciones de alcance.' });
    }

    const maxVus = Math.max(...dto.stages.map(s => s.target), 0);
    const seconds = totalSeconds(dto.stages);
    if (maxVus === 0) throw new BadRequestException('Al menos un stage debe tener target > 0.');
    if (seconds > 30 * 60) throw new BadRequestException('La duración total no puede superar 30 minutos.');
    if (seconds < 10) throw new BadRequestException('La duración total debe ser al menos 10 segundos.');

    const runKey = workspace.organizationId ? 'load-' + randomUUID() : null;
    if (workspace.organizationId && runKey) {
      // Reserva browser-seconds proporcional al tiempo de prueba (no es un
      // navegador de verdad, pero se contabiliza contra el mismo bucket).
      await this.usage.reserveRun(workspace.organizationId, projectId, runKey, {
        kind: 'BROWSER', browser: 'CHROMIUM', browserSeconds: seconds,
      });
    }

    return this.prisma.loadTest.create({
      data: {
        projectId,
        environmentId: environment.id,
        name: dto.name.trim(),
        url: guard.url.toString(),
        stages: dto.stages as unknown as Prisma.InputJsonValue,
        status: 'QUEUED',
        runKey,
        createdByUserId: workspace.userId ?? null,
      },
      select: { id: true, name: true, status: true, url: true, stages: true, createdAt: true },
    });
  }

  async summary(projectId: string, loadTestId: string, workspace: Workspace): Promise<Buffer> {
    await this.ensureProject(projectId, workspace);
    const row = await this.prisma.loadTest.findFirst({
      where: { id: loadTestId, projectId },
      select: { summaryKey: true },
    });
    if (!row) throw new NotFoundException('Prueba de carga no encontrada.');
    if (!row.summaryKey) throw new NotFoundException('Esta prueba aún no tiene resumen almacenado.');
    const bytes = await this.storage.read(row.summaryKey);
    if (!bytes) throw new NotFoundException('Resumen no disponible en el almacenamiento.');
    return bytes;
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...workspace }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

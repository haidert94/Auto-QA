import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UsageService } from '../commerce/usage.service';
import type { Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { diffResults, diffText, type ResultStatus } from '../common/diffs';
import { SCREENSHOT_READER, type ScreenshotReader } from '../exploration/screenshot-storage';
import { CreateRunDto } from './dto/create-run.dto';

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(SCREENSHOT_READER) private readonly evidence: ScreenshotReader,
  ) {}

  async list(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.testRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, scenarioId: true, environmentId: true,
        startedAt: true, completedAt: true, errorCode: true, createdAt: true,
        scenario: { select: { id: true, title: true } },
        results: { select: { id: true, status: true, durationMs: true, errorMessage: true, evidenceKey: true } },
      },
      take: 100,
    });
  }

  async get(projectId: string, runId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const run = await this.prisma.testRun.findFirst({
      where: { id: runId, projectId },
      include: {
        scenario: { select: { id: true, title: true } },
        environment: { select: { id: true, baseUrl: true, type: true } },
        results: true,
      },
    });
    if (!run) throw new NotFoundException('Ejecución no encontrada.');
    return run;
  }

  // Diff entre dos ejecuciones del mismo escenario. Si no se pasa previous,
  // se toma la ejecución COMPLETED anterior más reciente del mismo scenario.
  async diff(projectId: string, runId: string, previousId: string | null, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const current = await this.prisma.testRun.findFirst({
      where: { id: runId, projectId },
      select: { id: true, status: true, scenarioId: true, createdAt: true, completedAt: true, specText: true,
        results: { select: { id: true, scenarioId: true, status: true, durationMs: true } } },
    });
    if (!current) throw new NotFoundException('Ejecución no encontrada.');

    let previous: typeof current | null = null;
    if (previousId) {
      previous = await this.prisma.testRun.findFirst({
        where: { id: previousId, projectId },
        select: { id: true, status: true, scenarioId: true, createdAt: true, completedAt: true, specText: true,
          results: { select: { id: true, scenarioId: true, status: true, durationMs: true } } },
      });
      if (!previous) throw new NotFoundException('Ejecución de comparación no encontrada.');
    } else if (current.scenarioId) {
      previous = await this.prisma.testRun.findFirst({
        where: { projectId, scenarioId: current.scenarioId, createdAt: { lt: current.createdAt }, NOT: { id: current.id } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, scenarioId: true, createdAt: true, completedAt: true, specText: true,
          results: { select: { id: true, scenarioId: true, status: true, durationMs: true } } },
      });
    }

    const prevResults = (previous?.results ?? []).map(r => ({
      scenarioId: r.scenarioId, status: r.status as ResultStatus, durationMs: r.durationMs,
    }));
    const currResults = current.results.map(r => ({
      scenarioId: r.scenarioId, status: r.status as ResultStatus, durationMs: r.durationMs,
    }));
    return {
      previous: previous ? { id: previous.id, status: previous.status, createdAt: previous.createdAt, completedAt: previous.completedAt } : null,
      current: { id: current.id, status: current.status, createdAt: current.createdAt, completedAt: current.completedAt },
      resultChanges: diffResults(prevResults, currResults),
      specDiff: diffText(previous?.specText ?? null, current.specText ?? null),
      specs: { previous: previous?.specText ?? null, current: current.specText ?? null },
    };
  }

  async listForScenario(projectId: string, scenarioId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.testRun.findMany({
      where: { projectId, scenarioId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, environmentId: true,
        startedAt: true, completedAt: true, errorCode: true, createdAt: true,
        targetBrowser: true, targetDevice: true, targetProvider: true, providerSessionUrl: true,
        results: { select: { id: true, status: true, durationMs: true, errorMessage: true, evidenceKey: true } },
      },
      take: 50,
    });
  }

  async create(projectId: string, scenarioId: string, dto: CreateRunDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const scenario = await this.prisma.testScenario.findFirst({ where: { id: scenarioId, projectId }, select: { id: true } });
    if (!scenario) throw new NotFoundException('Escenario no encontrado.');

    const environment = await this.prisma.environment.findFirst({
      where: { id: dto.environmentId, projectId },
    });
    if (!environment) throw new NotFoundException('Entorno no encontrado en este proyecto.');
    if (!environment.authorizationConfirmed) {
      throw new BadRequestException('Confirma la autorización del entorno antes de ejecutar.');
    }
    if (!environment.readOnly) {
      throw new BadRequestException('Solo se permiten ejecuciones sobre entornos de solo lectura.');
    }

    const runKey = workspace.organizationId ? 'run-' + randomUUID() : null;
    if (workspace.organizationId && runKey) {
      // Presupuesto defensivo de 120 s de navegador por run; el worker liquida
      // el consumo real al terminar.
      await this.usage.reserveRun(workspace.organizationId, projectId, runKey, {
        kind: 'BROWSER', browser: 'CHROMIUM', browserSeconds: 120,
      });
    }

    return this.prisma.testRun.create({
      data: {
        projectId,
        scenarioId,
        environmentId: environment.id,
        status: 'QUEUED',
        runKey,
        createdByUserId: workspace.userId ?? null,
        targetBrowser: dto.targetBrowser ?? null,
        targetDevice: dto.targetDevice ?? null,
        targetProvider: dto.targetProvider ?? null,
      },
      select: { id: true, status: true, scenarioId: true, environmentId: true, createdAt: true, runKey: true, targetBrowser: true, targetDevice: true, targetProvider: true },
    });
  }

  async trace(projectId: string, runId: string, resultId: string, workspace: Workspace): Promise<Buffer> {
    await this.ensureProject(projectId, workspace);
    const result = await this.prisma.testResult.findFirst({
      where: { id: resultId, runId, run: { projectId } },
      select: { evidenceKey: true },
    });
    if (!result) throw new NotFoundException('Resultado no encontrado.');
    if (!result.evidenceKey) throw new NotFoundException('Esta ejecución no tiene traza almacenada.');
    const bytes = await this.evidence.read(result.evidenceKey);
    if (!bytes) throw new NotFoundException('Traza no disponible en el almacenamiento.');
    return bytes;
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...workspace }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

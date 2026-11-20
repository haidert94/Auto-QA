import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AiRouter } from '../ai/ai-router';
import { UsageService } from '../commerce/usage.service';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { diffResults, diffText, type ResultStatus } from '../common/diffs';
import { SCREENSHOT_READER, type ScreenshotReader } from '../exploration/screenshot-storage';
import { scenarioRunEnvironmentError } from './environment-policy';
import { RUN_STOP_REQUESTED, RUN_CANCELED_BY_USER } from './run-cancellation';
import { REPORT_SCENARIO_SCOPE } from './run-report-policy';
import { currentAutomation } from '../scenarios/automation-agent';
import { isManualScenario, MANUAL_SCENARIO_MESSAGE } from '../scenarios/scenario-tags';
import { CreateRunDto } from './dto/create-run.dto';

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly ai: AiRouter,
    @Inject(SCREENSHOT_READER) private readonly evidence: ScreenshotReader,
  ) {}

  // Pide a la IA una explicación del fallo basándose en el mensaje de
  // error del TestResult y los pasos del spec. No se guarda en BD; el
  // cliente puede repetir la petición si quiere.
  async explain(projectId: string, runId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const run = await this.prisma.testRun.findFirst({
      where: { id: runId, projectId },
      select: {
        status: true, errorCode: true, specText: true,
        scenario: { select: { title: true } },
        results: { select: { status: true, errorMessage: true, durationMs: true } },
      },
    });
    if (!run) throw new NotFoundException('Ejecución no encontrada.');
    const failed = run.results.find(r => r.status === 'FAILED' || r.status === 'BLOCKED');
    if (!failed && run.status !== 'FAILED') {
      return { usedFallback: true, model: 'rule-based', text: 'Esta ejecución no tiene fallos que explicar.' };
    }

    const prompt = [
      'Un escenario de pruebas Playwright falló. Explica en 3-5 bullets qué pasó, cuál es la causa probable y qué revisar.',
      run.scenario?.title ? `Escenario: ${run.scenario.title}` : '',
      run.errorCode ? `Código: ${run.errorCode}` : '',
      failed?.errorMessage ? `Error:\n${failed.errorMessage.slice(0, 1500)}` : '',
      '',
      'Spec ejecutado (resumen):',
      (run.specText ?? '').slice(0, 4000),
      '',
      'Responde en español, con lenguaje claro para un QA no técnico. No inventes causas que no estén en los datos.',
    ].filter(Boolean).join('\n');

    const response = await this.ai.dispatch({
      operation: 'failure-explanation',
      organizationId: workspace.organizationId ?? null,
      projectId,
      runKey: null,
      prompt,
      systemPrompt: 'Eres un ingeniero de QA explicando fallos de pruebas automatizadas.',
      maxOutputTokens: 1024,
    });

    return {
      usedFallback: response.usedFallback ?? false,
      model: response.model,
      text: response.text,
    };
  }

  async list(projectId: string, workspace: Workspace, runIds?: string[], forReport = false) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.testRun.findMany({
      where: {
        projectId, id: runIds ? { in: runIds } : undefined,
        ...(forReport ? { status: { not: 'CANCELED' }, ...REPORT_SCENARIO_SCOPE } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, scenarioId: true, environmentId: true,
        targetBrowser: true, targetDevice: true, targetProvider: true,
        startedAt: true, completedAt: true, errorCode: true, createdAt: true,
        scenario: { select: { id: true, title: true } },
        results: {
          where: forReport ? { scenario: { archivedAt: null } } : undefined,
          select: { id: true, status: true, durationMs: true, errorMessage: true, evidenceKey: true },
        },
      },
      take: 100,
    });
  }

  async activity(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const counts = await this.prisma.testRun.groupBy({
      by: ['status', 'errorCode'],
      where: { projectId, status: { in: ['RUNNING', 'QUEUED'] } },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    const activity = { running: 0, queued: 0, stopping: 0, oldestQueuedSeconds: 0 };
    const now = Date.now();
    for (const row of counts) {
      const bucket = row.status === 'QUEUED' ? 'queued' : row.errorCode === RUN_STOP_REQUESTED ? 'stopping' : 'running';
      activity[bucket] += row._count._all;
      if (bucket === 'queued' && row._min.createdAt) {
        activity.oldestQueuedSeconds = Math.max(activity.oldestQueuedSeconds, Math.floor((now - row._min.createdAt.getTime()) / 1000));
      }
    }
    return activity;
  }

  async cancelActive(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.$transaction(async tx => {
      const completedAt = new Date();
      const queued = await tx.testRun.updateManyAndReturn({
        where: { projectId, status: 'QUEUED' },
        data: { status: 'CANCELED', completedAt, errorCode: RUN_CANCELED_BY_USER },
        select: { runKey: true },
      });
      const runKeys = queued.flatMap(run => run.runKey ? [run.runKey] : []);
      if (workspace.organizationId && runKeys.length) {
        await tx.meteredRun.updateMany({
          where: { projectId, organizationId: workspace.organizationId, runKey: { in: runKeys }, completedAt: null },
          data: { browserSeconds: 0, completedAt },
        });
      }
      const running = await tx.testRun.updateMany({
        where: { projectId, status: 'RUNNING', OR: [{ errorCode: null }, { errorCode: { not: RUN_STOP_REQUESTED } }] },
        data: { errorCode: RUN_STOP_REQUESTED },
      });
      return { queuedCanceled: queued.length, runningRequested: running.count };
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
    const scenario = await this.prisma.testScenario.findFirst({
      where: { id: scenarioId, projectId, archivedAt: null },
      select: { id: true, tags: true, title: true, expectedResult: true, steps: true, automation: true },
    });
    if (!scenario) throw new NotFoundException('Escenario no encontrado.');
    if (isManualScenario(scenario)) throw new BadRequestException(MANUAL_SCENARIO_MESSAGE);
    const prepared = currentAutomation(scenario);
    if (dto.automationId !== undefined && dto.automationId !== (prepared?.id ?? null)) {
      throw new ConflictException('La automatización cambió. Actualiza el código antes de ejecutar.');
    }

    const environment = await this.prisma.environment.findFirst({
      where: { id: dto.environmentId, projectId },
    });
    if (!environment) throw new NotFoundException('Entorno no encontrado en este proyecto.');
    const environmentError = scenarioRunEnvironmentError(environment);
    if (environmentError) throw new BadRequestException(environmentError);

    const writeAuthorizationAt = environment.readOnly ? null : environment.authorizedAt;
    const requestedAuthorization = dto.writeAuthorizationAt ? Date.parse(dto.writeAuthorizationAt) : null;
    if (requestedAuthorization !== (writeAuthorizationAt?.getTime() ?? null)) {
      throw new ConflictException('El modo del entorno cambió o falta confirmar los cambios con datos de prueba.');
    }

    return this.prisma.$transaction(async tx => {
      const available = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "TestScenario"
        WHERE id = ${scenarioId} AND "projectId" = ${projectId} AND "archivedAt" IS NULL FOR SHARE
      `;
      if (!available.length) throw new NotFoundException('Escenario no encontrado.');

      const runKey = workspace.organizationId ? 'run-' + randomUUID() : null;
      if (workspace.organizationId && runKey) {
        // El worker liquida el consumo real a partir de la reserva de 120 s.
        await this.usage.reserveRun(workspace.organizationId, projectId, runKey, {
          kind: 'BROWSER', browser: 'CHROMIUM', browserSeconds: 120,
        }, tx);
      }

      return tx.testRun.create({
        data: {
          projectId,
          scenarioId,
          environmentId: environment.id,
          status: 'QUEUED',
          runKey,
          createdByUserId: workspace.userId ?? null,
          automation: prepared ? (prepared as unknown as Prisma.InputJsonValue) : undefined,
          writeAuthorizationAt,
          targetBrowser: dto.targetBrowser ?? null,
          targetDevice: dto.targetDevice ?? null,
          targetProvider: dto.targetProvider ?? null,
        },
        select: { id: true, status: true, scenarioId: true, environmentId: true, createdAt: true, runKey: true, targetBrowser: true, targetDevice: true, targetProvider: true },
      });
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
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

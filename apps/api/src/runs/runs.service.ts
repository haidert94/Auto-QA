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
import { defaultScenarioBrowser } from '../scenarios/playwright-generator';
import { CreateRunDto } from './dto/create-run.dto';
import type { EvidenceManifest, ManualEvidence } from './evidence-types';
import { readQualitySuiteActivity, stopQualitySuiteAttempts } from '../scenarios/quality-suite-activity';

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
    return this.findRuns(this.prisma, projectId, forReport, runIds);
  }

  async reportOverview(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.$transaction(async tx => {
      const current = await tx.$queryRaw<{ id: string }[]>`
        SELECT newest.id
        FROM "TestScenario" AS scenario
        CROSS JOIN LATERAL (
          SELECT run.id
          FROM "TestRun" AS run
          WHERE run."projectId" = ${projectId} AND run."scenarioId" = scenario.id AND run.status <> 'CANCELED'
          ORDER BY run."createdAt" DESC, run.id DESC
          LIMIT 1
        ) AS newest
        WHERE scenario."projectId" = ${projectId} AND scenario."archivedAt" IS NULL
      `;
      const latest = current.length ? await this.findRuns(tx, projectId, true, current.map(run => run.id)) : [];
      const history = await this.findRuns(tx, projectId, true);

      // Para que los escenarios MANUALES sin run aún aparezcan en el
      // reporte y el usuario pueda cargarles evidencia, inyectamos
      // pseudo-runs "pendientes" que viven solo en la respuesta: su id
      // tiene prefijo manual-pending-, el targetProvider es 'manual' y
      // llevan un TestResult sintético en SKIPPED. Al adjuntar evidencia,
      // el endpoint upsertManualRun crea el TestRun real y en el siguiente
      // refresh el pseudo-run desaparece.
      const covered = new Set(latest.flatMap(run => run.scenarioId ? [run.scenarioId] : []));
      const manualsSinRun = await tx.testScenario.findMany({
        where: {
          projectId, archivedAt: null, tags: { has: '@manual' },
          NOT: { id: { in: [...covered] } },
        },
        select: { id: true, title: true, tags: true },
      });
      const now = new Date();
      for (const scenario of manualsSinRun) {
        latest.push({
          id: `manual-pending-${scenario.id}`,
          status: 'COMPLETED',
          scenarioId: scenario.id,
          environmentId: null,
          targetBrowser: 'manual',
          targetDevice: null,
          targetProvider: 'manual',
          startedAt: null,
          completedAt: null,
          errorCode: null,
          createdAt: now,
          scenario: { id: scenario.id, title: scenario.title, tags: scenario.tags },
          results: [{ id: `manual-result-${scenario.id}`, status: 'SKIPPED', durationMs: null, errorMessage: null, evidenceKey: null }],
        } as unknown as (typeof latest)[number]);
      }
      return { latest, history };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private findRuns(prisma: Prisma.TransactionClient, projectId: string, forReport: boolean, runIds?: string[]) {
    return prisma.testRun.findMany({
      where: {
        projectId, id: runIds ? { in: runIds } : undefined,
        ...(forReport ? { status: { not: 'CANCELED' }, ...REPORT_SCENARIO_SCOPE } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, status: true, scenarioId: true, environmentId: true,
        targetBrowser: true, targetDevice: true, targetProvider: true,
        startedAt: true, completedAt: true, errorCode: true, createdAt: true,
        scenario: { select: { id: true, title: true, tags: true } },
        results: {
          where: forReport ? { scenario: { archivedAt: null } } : undefined,
          select: { id: true, status: true, durationMs: true, errorMessage: true, evidenceKey: true },
        },
      },
      take: runIds?.length ?? 100,
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
    const quality = await readQualitySuiteActivity(this.prisma, projectId);
    const allCounts = [...counts.map(row => ({
      status: row.status, errorCode: row.errorCode, count: row._count._all, queuedAt: row._min.createdAt,
    })), ...quality];
    const activity = { running: 0, queued: 0, stopping: 0, oldestQueuedSeconds: 0 };
    const now = Date.now();
    for (const row of allCounts) {
      const bucket = row.status === 'QUEUED' ? 'queued' : row.errorCode === RUN_STOP_REQUESTED ? 'stopping' : 'running';
      activity[bucket] += row.count;
      if (bucket === 'queued' && row.queuedAt) {
        activity.oldestQueuedSeconds = Math.max(activity.oldestQueuedSeconds, Math.floor((now - row.queuedAt.getTime()) / 1000));
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
      const quality = await stopQualitySuiteAttempts(tx, projectId, workspace, completedAt);
      const runKeys = [...queued.flatMap(run => run.runKey ? [run.runKey] : []), ...quality.runKeys];
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
      return { queuedCanceled: queued.length + quality.queuedCanceled, runningRequested: running.count + quality.runningRequested };
    });
  }

  async get(projectId: string, runId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const run = await this.prisma.testRun.findFirst({
      where: { id: runId, projectId },
      include: {
        scenario: { select: { id: true, title: true, tags: true } },
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

  // Crea o actualiza un TestRun manual para un escenario marcado con el
  // tag @manual. En lugar de encolar al worker, deja un TestRun en estado
  // COMPLETED con un único TestResult que lleva el status elegido por el
  // usuario y las screenshots que subió como data URL (base64) dentro del
  // JSON `evidence`. Si ya hay un TestRun manual previo, lo actualiza en
  // vez de crear otro (el usuario pidió "actualiza el último"). Vale como
  // registro para el reporte y para el ICSP, que calcula sobre los
  // TestResult sin importar su origen.
  async upsertManualRun(projectId: string, scenarioId: string, workspace: Workspace, body: {
    status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
    notes?: string;
    screenshots: Array<{ filename: string; mimetype: string; buffer: Buffer }>;
  }) {
    await this.ensureProject(projectId, workspace);
    const scenario = await this.prisma.testScenario.findFirst({
      where: { id: scenarioId, projectId, archivedAt: null },
      select: { id: true, tags: true, title: true },
    });
    if (!scenario) throw new NotFoundException('Escenario no encontrado.');
    if (!isManualScenario(scenario)) throw new BadRequestException('Este escenario no está marcado como manual.');
    if (!['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'].includes(body.status)) {
      throw new BadRequestException('Estado inválido.');
    }
    if (body.screenshots.length > 8) {
      throw new BadRequestException('Como máximo 8 imágenes por evidencia.');
    }
    for (const file of body.screenshots) {
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
        throw new BadRequestException(`Formato no soportado: ${file.mimetype}. Usa PNG, JPG, WebP o GIF.`);
      }
      if (file.buffer.byteLength > 1_500_000) {
        throw new BadRequestException(`La imagen ${file.filename} supera 1.5 MB.`);
      }
    }
    const screenshots = body.screenshots.map((file, index) => ({
      ordinal: index + 1,
      filename: file.filename.slice(0, 120),
      contentType: file.mimetype,
      data: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
    }));
    const notes = body.notes?.trim().slice(0, 2000) || null;
    const now = new Date();
    const evidence: Prisma.InputJsonValue = { manual: true, screenshots, notes, updatedAt: now.toISOString() };

    // Transacción: lee último run manual del escenario; si existe, actualiza
    // su único TestResult; si no, crea TestRun + TestResult nuevos.
    return this.prisma.$transaction(async tx => {
      const existing = await tx.testRun.findFirst({
        where: { projectId, scenarioId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, results: { select: { id: true } } },
      });
      if (existing && existing.status === 'COMPLETED' && existing.results.length) {
        await tx.testResult.update({
          where: { id: existing.results[0].id },
          data: { status: body.status, evidence, errorMessage: notes, durationMs: 0 },
        });
        await tx.testRun.update({ where: { id: existing.id }, data: { completedAt: now, startedAt: now, status: 'COMPLETED' } });
        return { id: existing.id, updated: true };
      }
      const run = await tx.testRun.create({
        data: {
          projectId, scenarioId, environmentId: null,
          status: 'COMPLETED', runKey: null, createdByUserId: workspace.userId ?? null,
          startedAt: now, completedAt: now,
          targetBrowser: 'manual', targetProvider: 'manual', targetDevice: null,
        },
        select: { id: true },
      });
      await tx.testResult.create({
        data: {
          runId: run.id, scenarioId, status: body.status, evidence,
          errorMessage: notes, durationMs: 0,
        },
      });
      return { id: run.id, updated: false };
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

    const targetBrowser = dto.targetBrowser ?? defaultScenarioBrowser(scenario);
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
          kind: 'BROWSER', browser: targetBrowser, browserSeconds: 120,
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
          targetBrowser,
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
      select: { evidence: true, evidenceKey: true },
    });
    if (!result) throw new NotFoundException('Resultado no encontrado.');
    const trace = normaliseEvidence(result.evidence, result.evidenceKey).trace;
    if (!trace) throw new NotFoundException('Esta ejecución no tiene traza almacenada.');
    const bytes = await this.evidence.read(trace).catch(() => null);
    if (!bytes || bytes.length === 0) {
      // Self-heal: la clave en DB apunta a un archivo que ya no está en el
      // storage (reemplazo de deploy, worker externo que ya no corre, etc.).
      // Limpiamos la referencia para que la UI deje de ofrecer la descarga.
      if (result.evidenceKey === trace) {
        await this.prisma.testResult.updateMany({ where: { id: resultId, evidenceKey: trace }, data: { evidenceKey: null } }).catch(() => {});
      }
      throw new NotFoundException('Traza no disponible en el almacenamiento.');
    }
    return bytes;
  }

  // Manifiesto de evidencias (trace + video + screenshots por paso).
  // La UI lo pide una vez y después referencia cada asset por su key opaca.
  async evidenceManifest(projectId: string, runId: string, resultId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const result = await this.prisma.testResult.findFirst({
      where: { id: resultId, runId, run: { projectId } },
      select: { evidence: true, evidenceKey: true, status: true },
    });
    if (!result) throw new NotFoundException('Resultado no encontrado.');
    const manifest = normaliseEvidence(result.evidence, result.evidenceKey);
    return { status: result.status, ...manifest, manual: manualEvidence(result.evidence) };
  }

  // Empaqueta un reporte consolidado en zip estilo SerenityBDD con index.html,
  // una página por escenario y sus assets (screenshots, video, trace). Usa
  // el mismo filtro de runs que la pestaña Reportes: ids opcional, filter
  // por categoría, tag opcional. runIds no debe exceder 200 para evitar zips
  // enormes que bloqueen el proceso de API.
  async exportReport(projectId: string, runIds: string[], workspace: Workspace): Promise<{ bytes: Buffer; filename: string }> {
    await this.ensureProject(projectId, workspace);
    if (!runIds.length || runIds.length > 200) {
      throw new BadRequestException('Debes seleccionar entre 1 y 200 ejecuciones.');
    }
    const runs = await this.prisma.testRun.findMany({
      where: { id: { in: runIds }, projectId },
      select: {
        id: true, status: true, createdAt: true, startedAt: true, completedAt: true, errorCode: true,
        targetBrowser: true, targetDevice: true, targetProvider: true,
        scenario: { select: { id: true, title: true, tags: true } },
        results: { select: { id: true, status: true, durationMs: true, errorMessage: true, evidence: true, evidenceKey: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!runs.length) throw new NotFoundException('No se encontraron ejecuciones para el reporte.');

    const JSZip = (await import('jszip')).default as unknown as new () => { file(path: string, data: Buffer | string): void; generateAsync(opts: { type: 'nodebuffer'; compression: 'DEFLATE'; compressionOptions: { level: number } }): Promise<Buffer> };
    const zip = new JSZip();

    const summary = {
      generatedAt: new Date().toISOString(),
      projectId,
      totalRuns: runs.length,
      byStatus: {
        passed: runs.filter(r => r.status === 'COMPLETED' && r.results.every(x => x.status === 'PASSED')).length,
        failed: runs.filter(r => r.status === 'FAILED' || r.results.some(x => x.status === 'FAILED')).length,
        pending: runs.filter(r => r.status === 'QUEUED' || r.status === 'RUNNING').length,
      },
    };
    zip.file('summary.json', JSON.stringify(summary, null, 2));
    zip.file('assets/style.css', REPORT_CSS);

    // Un .html por run con sus screenshots inline y links a video/trace.
    for (const run of runs) {
      for (const result of run.results) {
        const manifest = normaliseEvidence(result.evidence, result.evidenceKey);
        const slug = result.id;
        // Screenshots inline
        for (const shot of manifest.screenshots) {
          try {
            const bytes = await this.evidence.read(shot.key);
            if (bytes?.length) zip.file(`tests/${slug}/screenshots/step-${shot.step}-${shot.action}.png`, bytes);
          } catch { /* ignore */ }
        }
        if (manifest.video) {
          try {
            const bytes = await this.evidence.read(manifest.video);
            if (bytes?.length) zip.file(`tests/${slug}/video.webm`, bytes);
          } catch { /* ignore */ }
        }
        if (manifest.trace) {
          try {
            const bytes = await this.evidence.read(manifest.trace);
            if (bytes?.length) zip.file(`tests/${slug}/trace.zip`, bytes);
          } catch { /* ignore */ }
        }
        zip.file(`tests/${slug}/index.html`, renderResultPage(run, result, manifest));
      }
    }
    zip.file('index.html', renderIndexPage(runs));

    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const filename = `reporte-autoqa-${new Date().toISOString().slice(0, 10)}.zip`;
    return { bytes, filename };
  }

  // Lee un asset individual (screenshot PNG o video WebM). Verifica que la
  // key esté en el manifiesto para que no se puedan leer objetos arbitrarios
  // del bucket sólo conociendo su hex32.
  async evidenceAsset(
    projectId: string, runId: string, resultId: string, type: 'screenshot' | 'video',
    key: string, workspace: Workspace,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    await this.ensureProject(projectId, workspace);
    const result = await this.prisma.testResult.findFirst({
      where: { id: resultId, runId, run: { projectId } },
      select: { evidence: true },
    });
    if (!result?.evidence) throw new NotFoundException('Esta ejecución no tiene evidencias.');
    const manifest = normaliseEvidence(result.evidence, null);
    const allowed = type === 'screenshot'
      ? manifest.screenshots.some(s => s.key === key)
      : manifest.video === key;
    if (!allowed) throw new NotFoundException('Asset no pertenece a este resultado.');
    const bytes = await this.evidence.read(key).catch(() => null);
    if (!bytes || bytes.length === 0) throw new NotFoundException('Asset no disponible en el almacenamiento.');
    return { bytes, contentType: type === 'screenshot' ? 'image/png' : 'video/webm' };
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

const REPORT_CSS = `
:root { --ink:#1a1a1a; --muted:#6a6a6a; --line:#e3e3e3; --surface:#fafafa; --pass:#15803d; --fail:#b91c1c; --pending:#a16207; }
* { box-sizing: border-box; }
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--surface); margin: 0; padding: 24px; }
h1, h2, h3 { margin: 0 0 12px; font-weight: 600; }
h1 { font-size: 22px; }
h2 { font-size: 18px; }
h3 { font-size: 15px; color: var(--muted); }
table { width: 100%; border-collapse: collapse; background: white; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--line); }
th { background: #f5f5f5; font-weight: 600; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .3px; }
tr:last-child td { border-bottom: none; }
.state { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
.state--pass { background: #dcfce7; color: var(--pass); }
.state--fail { background: #fee2e2; color: var(--fail); }
.state--pending { background: #fef3c7; color: var(--pending); }
a { color: #1d4ed8; text-decoration: none; }
a:hover { text-decoration: underline; }
.steps { display: grid; gap: 16px; margin-top: 20px; }
.step { background: white; border: 1px solid var(--line); border-radius: 6px; padding: 14px; }
.step img { max-width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 4px; margin-top: 8px; }
.meta dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 18px; margin: 0; }
.meta dt { font-weight: 500; color: var(--muted); }
.meta dd { margin: 0; }
pre { background: #1a1a1a; color: #eee; padding: 12px; border-radius: 4px; overflow: auto; font-size: 12px; }
.nav { margin-bottom: 20px; }
.nav a { background: white; border: 1px solid var(--line); padding: 6px 12px; border-radius: 4px; font-size: 12px; }
`;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function renderIndexPage(runs: Array<{ id: string; status: string; createdAt: Date; targetBrowser: string | null; scenario: { id: string; title: string } | null; results: Array<{ id: string; status: string; durationMs: number | null }> }>): string {
  const rows = runs.flatMap(run => run.results.map(result => {
    const stateClass = result.status === 'PASSED' ? 'pass' : (result.status === 'FAILED' ? 'fail' : 'pending');
    return `<tr>
      <td><a href="tests/${esc(result.id)}/index.html">${esc(run.scenario?.title ?? run.id.slice(0, 8))}</a><br><small>${esc(run.id.slice(0, 8))} · ${esc(run.createdAt.toISOString())}</small></td>
      <td>${esc(run.targetBrowser ?? '—')}</td>
      <td>${result.durationMs ? result.durationMs + ' ms' : '—'}</td>
      <td><span class="state state--${stateClass}">${esc(result.status)}</span></td>
    </tr>`;
  })).join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte AutoQA</title><link rel="stylesheet" href="assets/style.css"></head>
<body><h1>Reporte AutoQA</h1><h3>${runs.length} ejecuciones · ${new Date().toISOString()}</h3>
<table><thead><tr><th>Escenario / Run</th><th>Navegador</th><th>Duración</th><th>Estado</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}

function renderResultPage(
  run: { id: string; createdAt: Date; targetBrowser: string | null; targetProvider: string | null; errorCode: string | null; scenario: { id: string; title: string } | null },
  result: { id: string; status: string; durationMs: number | null; errorMessage: string | null },
  manifest: EvidenceManifest,
): string {
  const title = run.scenario?.title ?? run.id.slice(0, 8);
  const stateClass = result.status === 'PASSED' ? 'pass' : (result.status === 'FAILED' ? 'fail' : 'pending');
  const steps = manifest.screenshots.map(s => `<div class="step">
    <h3>Paso ${s.step} · ${esc(s.action)} <span class="state state--${s.status === 'pass' ? 'pass' : 'fail'}">${s.status.toUpperCase()}</span></h3>
    <img src="screenshots/step-${s.step}-${esc(s.action)}.png" alt="Paso ${s.step}">
  </div>`).join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)} · AutoQA</title><link rel="stylesheet" href="../../assets/style.css"></head>
<body><div class="nav"><a href="../../index.html">← Volver al índice</a></div>
<h1>${esc(title)}</h1><span class="state state--${stateClass}">${esc(result.status)}</span>
<section class="meta"><dl>
<dt>Run</dt><dd>${esc(run.id)}</dd>
<dt>Fecha</dt><dd>${esc(run.createdAt.toISOString())}</dd>
<dt>Navegador</dt><dd>${esc(run.targetBrowser ?? '—')}</dd>
<dt>Proveedor</dt><dd>${esc(run.targetProvider ?? 'LOCAL')}</dd>
<dt>Duración</dt><dd>${result.durationMs ? result.durationMs + ' ms' : '—'}</dd>
${run.errorCode ? `<dt>Error</dt><dd>${esc(run.errorCode)}</dd>` : ''}
</dl></section>
${result.errorMessage ? `<h2>Mensaje de error</h2><pre>${esc(result.errorMessage)}</pre>` : ''}
${manifest.video ? '<h2>Video</h2><video controls style="max-width:100%"><source src="video.webm" type="video/webm"></video>' : ''}
${manifest.trace ? '<p><a href="trace.zip" download>Descargar trace.zip (visor Playwright)</a></p>' : ''}
<h2>Pasos (${manifest.screenshots.length})</h2>
<div class="steps">${steps || '<p>Sin screenshots por paso.</p>'}</div>
</body></html>`;
}

// Normaliza el campo Json del schema a un manifiesto tipado, y acepta el
// fallback evidenceKey (trace legacy) para runs anteriores al JSON.
export function normaliseEvidence(raw: unknown, legacyTraceKey: string | null): EvidenceManifest {
  const base: EvidenceManifest = { trace: legacyTraceKey, video: null, screenshots: [] };
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const trace = typeof obj.trace === 'string' ? obj.trace : base.trace;
  const video = typeof obj.video === 'string' ? obj.video : null;
  const list = Array.isArray(obj.screenshots) ? obj.screenshots : [];
  const screenshots = list
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(s => ({
      step: typeof s.step === 'number' ? s.step : 0,
      action: typeof s.action === 'string' ? s.action : '',
      key: typeof s.key === 'string' ? s.key : '',
      status: s.status === 'fail' ? 'fail' : 'pass',
    }) as EvidenceManifest['screenshots'][number])
    .filter(s => s.key);
  return { trace, video, screenshots };
}

function manualEvidence(value: Prisma.JsonValue): ManualEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.manual !== true) return null;
  const screenshots = Array.isArray(value.screenshots) ? value.screenshots.slice(0, 8) : [];
  return {
    notes: typeof value.notes === 'string' ? value.notes.slice(0, 2000) : null,
    screenshots: screenshots.flatMap(shot => {
      if (!shot || typeof shot !== 'object' || Array.isArray(shot)
        || typeof shot.filename !== 'string' || typeof shot.data !== 'string' || shot.data.length > 2_000_100
        || !/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(shot.data)) return [];
      return [{ filename: shot.filename.slice(0, 120), data: shot.data }];
    }),
  };
}

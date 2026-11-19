// Ejecuta UN TestRun: carga escenario y entorno, genera un spec con arnés
// (filtro de requests + baseURL), escribe los archivos en un directorio
// temporal, lanza `playwright test` como subproceso con el reporter JSON,
// parsea el resultado y persiste TestResult. El trace.zip se sube al
// ScreenshotStorage (local o S3) con la misma clave opaca hex-32.
//
// Un run = un escenario (fase 6.3). El batch queda para una iteración
// posterior.

import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { buildBrowserstackWsEndpoint, generateHarnessedSpec, generatePlaywrightConfig, readGeneratorSteps, type HarnessEnvironment } from '../../api/src/scenarios/playwright-generator';
import { scenarioRunEnvironmentError } from '../../api/src/runs/environment-policy';
import { RUN_CANCELED_BY_USER, RUN_STOP_REQUESTED } from '../../api/src/runs/run-cancellation';
import { readPreparedAutomation } from '../../api/src/scenarios/automation-agent';
import { isManualScenario, MANUAL_SCENARIO_MESSAGE } from '../../api/src/scenarios/scenario-tags';
import { type ScreenshotStorage } from './screenshot-storage';

export type ExecutionClaim = {
  id: string;
  projectId: string;
  scenarioId: string | null;
  environmentId: string | null;
  runKey: string | null;
  targetBrowser: string | null;
  targetDevice: string | null;
  targetProvider: string | null;
  automation?: unknown;
  writeAuthorizationAt?: Date | null;
};

function resolveWsEndpoint(claim: ExecutionClaim): { wsEndpoint: string | null; error: string | null } {
  const provider = (claim.targetProvider ?? 'LOCAL').toUpperCase();
  if (provider === 'LOCAL') return { wsEndpoint: null, error: null };
  if (provider === 'BROWSERSTACK') {
    const userName = process.env.AUTOQA_BROWSERSTACK_USERNAME?.trim();
    const accessKey = process.env.AUTOQA_BROWSERSTACK_ACCESS_KEY?.trim();
    if (!userName || !accessKey) {
      return { wsEndpoint: null, error: 'provider-not-configured' };
    }
    const wsEndpoint = buildBrowserstackWsEndpoint({
      userName, accessKey,
      browser: claim.targetBrowser,
      device: claim.targetDevice,
      projectName: 'AutoQA',
      buildName: 'autoqa-' + (process.env.AUTOQA_BROWSERSTACK_BUILD ?? new Date().toISOString().slice(0, 10)),
      sessionName: 'run-' + claim.id.slice(0, 8),
    });
    return { wsEndpoint, error: null };
  }
  return { wsEndpoint: null, error: 'provider-not-supported' };
}

type Logger = (level: 'INFO' | 'WARN' | 'ERROR', detail: string) => void;

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function toHarnessPaths(value: unknown): HarnessEnvironment['allowedPaths'] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is HarnessEnvironment['allowedPaths'][number] =>
    typeof entry === 'string' || (!!entry && typeof entry.host === 'string' && typeof entry.path === 'string'));
}

export async function runTestRun(
  prisma: PrismaClient,
  claim: ExecutionClaim,
  storage: ScreenshotStorage,
  log: Logger = () => {},
): Promise<void> {
  const startedAt = Date.now();
  let workdir: string | undefined;
  const shouldStop = async () => {
    const current = await prisma.testRun.findUnique({
      where: { id: claim.id }, select: { status: true, errorCode: true },
    });
    return !current || current.status !== 'RUNNING' || current.errorCode === RUN_STOP_REQUESTED;
  };
  const fail = (code: string, message: string) => finishRun(prisma, claim, startedAt,
    { status: 'FAILED', errorCode: code }, { status: 'BLOCKED', errorMessage: message.slice(0, 4000) });
  const finishStopped = () => finishRun(prisma, claim, startedAt, {});
  try {
    if (await shouldStop()) {
      await finishStopped();
      return;
    }
    if (!claim.scenarioId || !claim.environmentId) {
      await fail('missing-scenario-or-environment', 'scenarioId y environmentId son requeridos.');
      return;
    }

    const scenario = await prisma.testScenario.findUnique({
      where: { id: claim.scenarioId },
      select: { id: true, title: true, steps: true, expectedResult: true, tags: true },
    });
    if (!scenario) {
      await fail('scenario-missing', 'El escenario fue borrado.');
      return;
    }

    if (isManualScenario(scenario)) {
      await fail('manual-scenario', MANUAL_SCENARIO_MESSAGE);
      return;
    }

    const environment = await prisma.environment.findUnique({
      where: { id: claim.environmentId, projectId: claim.projectId },
      select: {
        type: true, baseUrl: true, allowedHosts: true, allowedPaths: true, excludedPaths: true,
        authorizationConfirmed: true, authorizedAt: true, readOnly: true,
      },
    });
    if (!environment) {
      await fail('environment-missing', 'El entorno fue borrado.');
      return;
    }
    const environmentError = scenarioRunEnvironmentError(environment);
    if (environmentError) {
      await fail('environment-unauthorized', environmentError);
      return;
    }
    const currentAuthorization = environment.readOnly ? null : environment.authorizedAt?.getTime();
    if ((claim.writeAuthorizationAt?.getTime() ?? null) !== currentAuthorization) {
      await fail('environment-mode-changed', 'La autorización del entorno cambió después de encolar la prueba.');
      return;
    }

    const prepared = readPreparedAutomation(claim.automation);
    if (claim.automation && !prepared) {
      await fail('invalid-automation', 'No se pudo recuperar la automatización de esta ejecución.');
      return;
    }
    const steps = prepared?.steps ?? readGeneratorSteps(scenario.steps);

    const harness: HarnessEnvironment = {
      baseUrl: environment.baseUrl,
      allowedHosts: toStringArray(environment.allowedHosts),
      allowedPaths: toHarnessPaths(environment.allowedPaths),
      excludedPaths: toHarnessPaths(environment.excludedPaths),
      allowWrites: !environment.readOnly,
    };
    const spec = generateHarnessedSpec({
      id: scenario.id, title: prepared?.title ?? scenario.title, expectedResult: scenario.expectedResult, steps,
    }, harness, { browser: claim.targetBrowser, device: claim.targetDevice });

    // Directorio de trabajo aislado; limpiamos al final (éxito o error).
    workdir = await mkdtemp(join(tmpdir(), 'autoqa-run-'));
    const outputDir = join(workdir, 'playwright-output');
    const specPath = join(workdir, 'scenario.spec.ts');
    const configPath = join(workdir, 'playwright.config.ts');
    await mkdir(outputDir, { recursive: true });
    await writeFile(specPath, spec, { encoding: 'utf8' });
    const { wsEndpoint, error: providerError } = resolveWsEndpoint(claim);
    if (providerError) {
      await fail(providerError, 'El proveedor ' + (claim.targetProvider ?? '') + ' no está disponible.');
      return;
    }
    await writeFile(configPath, generatePlaywrightConfig({
      outputDir, browser: claim.targetBrowser, wsEndpoint,
    }), { encoding: 'utf8' });

    if (await shouldStop()) {
      await finishStopped();
      return;
    }
    const outcome = await spawnPlaywright(workdir, configPath, log, shouldStop);
    if (await shouldStop()) {
      await finishStopped();
      return;
    }
    const report = await readReport(workdir).catch(() => null);
    const summary = summariseReport(report, outcome.exitCode);
    const tracePath = extractTracePath(report, outputDir);
    let evidenceKey: string | null = null;
    if (tracePath) {
      try {
        const zipBytes = await readFile(tracePath);
        evidenceKey = await storage.put(zipBytes, { contentType: 'application/zip' });
      } catch (error) {
        log('WARN', 'No se pudo subir el trace: ' + (error instanceof Error ? error.message : String(error)));
      }
    }

    const providerSessionUrl = extractProviderSessionUrl(report, claim.targetProvider);
    await finishRun(prisma, claim, startedAt, {
      status: summary.status === 'PASSED' ? 'COMPLETED' : 'FAILED',
      errorCode: summary.status === 'PASSED' ? null : (summary.errorCode ?? 'test-failed'),
      specText: spec,
      providerSessionUrl,
    }, {
      status: summary.status,
      durationMs: summary.durationMs,
      errorMessage: summary.errorMessage?.slice(0, 4000) ?? null,
      evidenceKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'worker-crashed: ' + message);
    await fail('worker-crashed', message);
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

type SpawnOutcome = { exitCode: number | null };

function spawnPlaywright(workdir: string, configPath: string, log: Logger, shouldStop: () => Promise<boolean>): Promise<SpawnOutcome> {
  return new Promise((resolvePromise, rejectPromise) => {
    const windows = process.platform === 'win32';
    const child = spawn('npx', ['--yes', 'playwright', 'test', '--config', resolve(configPath)], {
      cwd: workdir,
      env: { ...process.env, PLAYWRIGHT_HTML_REPORT: '/dev/null' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: windows,
      detached: !windows,
    });
    child.stdout.resume();
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-800); });
    let closed = false;
    let poll: NodeJS.Timeout | undefined;
    let forceStop: NodeJS.Timeout | undefined;

    function terminate(signal: NodeJS.Signals) {
      if (closed || !child.pid) return;
      if (windows) {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, error => {
          if (error && !closed) child.kill('SIGTERM');
        });
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
      }
    }

    async function checkStop() {
      try {
        if (await shouldStop()) {
          log('INFO', 'Solicitud de detener Playwright recibida.');
          terminate('SIGTERM');
          if (!closed && !windows) forceStop = setTimeout(() => terminate('SIGKILL'), 3000);
          return;
        }
      } catch {
        log('WARN', 'No se pudo consultar la solicitud de detener Playwright.');
      }
      if (!closed) poll = setTimeout(() => void checkStop(), 1000);
    }

    function cleanup() {
      closed = true;
      clearTimeout(timeout);
      clearTimeout(poll);
      clearTimeout(forceStop);
    }

    const timeout = setTimeout(() => {
      log('WARN', 'Playwright excedió 10 minutos; forzando kill.');
      terminate('SIGKILL');
    }, 10 * 60 * 1000);
    poll = setTimeout(() => void checkStop(), 1000);
    child.once('error', error => { cleanup(); rejectPromise(error); });
    child.once('close', exitCode => {
      cleanup();
      if (stderr) log('WARN', 'stderr: ' + stderr);
      resolvePromise({ exitCode });
    });
  });
}

async function readReport(workdir: string): Promise<any | null> {
  try {
    const raw = await readFile(join(workdir, 'report.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function summariseReport(report: any, exitCode: number | null): { status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED'; durationMs: number | null; errorMessage: string | null; errorCode: string | null } {
  const specs = report?.suites?.flatMap((s: any) => s?.specs ?? []) ?? [];
  const spec = specs[0];
  const test = spec?.tests?.[0];
  const result = test?.results?.[0];
  if (!result) {
    return {
      status: 'BLOCKED',
      durationMs: null,
      errorMessage: exitCode === 0 ? 'Sin resultados en el reporte.' : `playwright exit ${exitCode}`,
      errorCode: 'no-results',
    };
  }
  const durationMs = typeof result.duration === 'number' ? Math.round(result.duration) : null;
  const errorMessage = result.error?.message ?? result.errors?.[0]?.message ?? null;
  switch (result.status) {
    case 'passed':
      return { status: 'PASSED', durationMs, errorMessage: null, errorCode: null };
    case 'skipped':
      return { status: 'SKIPPED', durationMs, errorMessage: null, errorCode: null };
    case 'timedOut':
      return { status: 'FAILED', durationMs, errorMessage: errorMessage ?? 'timeout', errorCode: 'timeout' };
    case 'interrupted':
      return { status: 'BLOCKED', durationMs, errorMessage: errorMessage ?? 'interrupted', errorCode: 'interrupted' };
    default:
      return { status: 'FAILED', durationMs, errorMessage: errorMessage ?? 'failed', errorCode: 'failed' };
  }
}

function extractProviderSessionUrl(report: any, provider: string | null): string | null {
  if (!provider || provider.toUpperCase() === 'LOCAL') return null;
  // BrowserStack adjunta la URL de la sesión en los stdout/stderr del test
  // con un prefijo bs:// o la emite como attachment. Acá miramos los
  // attachments buscando una URL dashboard.browserstack.com.
  const attachments: any[] = report?.suites?.flatMap((s: any) =>
    s?.specs?.flatMap((spec: any) =>
      spec?.tests?.flatMap((t: any) =>
        t?.results?.flatMap((r: any) => r?.attachments ?? []) ?? []) ?? []) ?? []) ?? [];
  const link = attachments.find(a => typeof a?.body === 'string' && /browserstack\.com\/sessions/.test(a.body));
  if (link) {
    const match = /https?:\/\/[^\s"]+browserstack\.com\/sessions\/[a-f0-9-]+/i.exec(link.body);
    if (match) return match[0];
  }
  return null;
}

function extractTracePath(report: any, outputDir: string): string | null {
  const attachments: any[] = report?.suites?.flatMap((s: any) =>
    s?.specs?.flatMap((spec: any) =>
      spec?.tests?.flatMap((t: any) =>
        t?.results?.flatMap((r: any) => r?.attachments ?? []) ?? []) ?? []) ?? []) ?? [];
  const trace = attachments.find(a => a?.name === 'trace' && typeof a.path === 'string');
  if (trace?.path) return trace.path;
  // Fallback: Playwright suele poner los traces en outputDir.
  return null;
  void outputDir;
}

async function finishRun(
  prisma: PrismaClient,
  claim: ExecutionClaim,
  startedAt: number,
  data: Pick<Prisma.TestRunUncheckedUpdateInput, 'status' | 'errorCode' | 'specText' | 'providerSessionUrl'>,
  result?: Omit<Prisma.TestResultUncheckedCreateInput, 'runId' | 'scenarioId'>,
): Promise<void> {
  const completedAt = new Date();
  await prisma.$transaction(async tx => {
    const [run] = await tx.$queryRaw<{ errorCode: string | null }[]>`
      SELECT "errorCode" FROM "TestRun" WHERE id = ${claim.id} AND status = 'RUNNING' FOR UPDATE
    `;
    if (!run) return;
    const canceled = run.errorCode === RUN_STOP_REQUESTED;
    await tx.testRun.update({
      where: { id: claim.id },
      data: {
        ...(canceled ? { status: 'CANCELED', errorCode: RUN_CANCELED_BY_USER } : data),
        completedAt,
      },
    });
    if (!canceled && result && claim.scenarioId) {
      await tx.testResult.create({ data: { ...result, runId: claim.id, scenarioId: claim.scenarioId } });
    }
    if (!claim.runKey) return;
    const project = await tx.project.findUnique({ where: { id: claim.projectId }, select: { organizationId: true } });
    if (!project?.organizationId) return;
    await tx.meteredRun.updateMany({
      where: { projectId: claim.projectId, organizationId: project.organizationId, runKey: claim.runKey, completedAt: null },
      data: { browserSeconds: Math.max(1, Math.round((completedAt.getTime() - startedAt) / 1000)), completedAt },
    });
  });
}

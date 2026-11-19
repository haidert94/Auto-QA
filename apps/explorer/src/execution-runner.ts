// Ejecuta UN TestRun: carga escenario y entorno, genera un spec con arnés
// (filtro de requests + baseURL), escribe los archivos en un directorio
// temporal, lanza `playwright test` como subproceso con el reporter JSON,
// parsea el resultado y persiste TestResult. El trace.zip se sube al
// ScreenshotStorage (local o S3) con la misma clave opaca hex-32.
//
// Un run = un escenario (fase 6.3). El batch queda para una iteración
// posterior.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { buildBrowserstackWsEndpoint, generateHarnessedSpec, generatePlaywrightConfig, type HarnessEnvironment } from '../../api/src/scenarios/playwright-generator';
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

export async function runTestRun(
  prisma: PrismaClient,
  claim: ExecutionClaim,
  storage: ScreenshotStorage,
  log: Logger = () => {},
): Promise<void> {
  const startedAt = Date.now();
  if (!claim.scenarioId || !claim.environmentId) {
    await failRun(prisma, claim, 'missing-scenario-or-environment', 'scenarioId y environmentId son requeridos.');
    return;
  }

  const scenario = await prisma.testScenario.findUnique({
    where: { id: claim.scenarioId },
    select: { id: true, title: true, steps: true, expectedResult: true, tags: true },
  });
  if (!scenario) {
    await failRun(prisma, claim, 'scenario-missing', 'El escenario fue borrado.');
    return;
  }

  if (isManualScenario(scenario)) {
    await failRun(prisma, claim, 'manual-scenario', MANUAL_SCENARIO_MESSAGE);
    return;
  }

  const environment = await prisma.environment.findUnique({
    where: { id: claim.environmentId },
    select: { baseUrl: true, allowedHosts: true, allowedPaths: true, excludedPaths: true, authorizationConfirmed: true, readOnly: true },
  });
  if (!environment) {
    await failRun(prisma, claim, 'environment-missing', 'El entorno fue borrado.');
    return;
  }
  if (!environment.authorizationConfirmed || !environment.readOnly) {
    await failRun(prisma, claim, 'environment-unauthorized', 'El entorno ya no está autorizado o es read-write.');
    return;
  }

  const rawSteps: unknown[] = Array.isArray(scenario.steps) ? (scenario.steps as unknown[]) : [];
  const steps = rawSteps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => ({
      ordinal: typeof s.ordinal === 'number' ? s.ordinal : i + 1,
      action: typeof s.action === 'string' ? s.action : '',
      data: typeof s.data === 'string' ? s.data : undefined,
      expected: typeof s.expected === 'string' ? s.expected : undefined,
    }))
    .filter(s => s.action.length > 0);

  const harness: HarnessEnvironment = {
    baseUrl: environment.baseUrl,
    allowedHosts: toStringArray(environment.allowedHosts),
    allowedPaths: toStringArray(environment.allowedPaths),
    excludedPaths: toStringArray(environment.excludedPaths),
  };
  const spec = generateHarnessedSpec({
    id: scenario.id, title: scenario.title, expectedResult: scenario.expectedResult, steps,
  }, harness, { browser: claim.targetBrowser, device: claim.targetDevice });

  // Directorio de trabajo aislado; limpiamos al final (éxito o error).
  const workdir = await mkdtemp(join(tmpdir(), 'autoqa-run-'));
  const outputDir = join(workdir, 'playwright-output');
  const specPath = join(workdir, 'scenario.spec.ts');
  const configPath = join(workdir, 'playwright.config.ts');
  await mkdir(outputDir, { recursive: true });
  await writeFile(specPath, spec, { encoding: 'utf8' });
  const { wsEndpoint, error: providerError } = resolveWsEndpoint(claim);
  if (providerError) {
    await failRun(prisma, claim, providerError, 'El proveedor ' + (claim.targetProvider ?? '') + ' no está disponible.');
    return;
  }
  await writeFile(configPath, generatePlaywrightConfig({
    outputDir, browser: claim.targetBrowser, wsEndpoint,
  }), { encoding: 'utf8' });

  try {
    const outcome = await spawnPlaywright(workdir, configPath, log);
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
    await prisma.$transaction(async tx => {
      await tx.testResult.create({
        data: {
          runId: claim.id,
          scenarioId: scenario.id,
          status: summary.status,
          durationMs: summary.durationMs,
          errorMessage: summary.errorMessage?.slice(0, 4000) ?? null,
          evidenceKey,
        },
      });
      await tx.testRun.update({
        where: { id: claim.id },
        data: {
          status: summary.status === 'PASSED' ? 'COMPLETED' : 'FAILED',
          completedAt: new Date(),
          errorCode: summary.status === 'PASSED' ? null : (summary.errorCode ?? 'test-failed'),
          specText: spec,
          providerSessionUrl,
        },
      });
    });
    await settleUsage(prisma, claim, startedAt);
  } catch (error) {
    log('ERROR', 'worker-crashed: ' + (error instanceof Error ? error.message : String(error)));
    await failRun(prisma, claim, 'worker-crashed', error instanceof Error ? error.message : String(error));
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

type SpawnOutcome = { exitCode: number | null };

function spawnPlaywright(workdir: string, configPath: string, log: Logger): Promise<SpawnOutcome> {
  return new Promise(resolvePromise => {
    // playwright test busca el config relativo; usamos ruta absoluta para
    // evitar sorpresas con el cwd del worker.
    const child = spawn('npx', ['--yes', 'playwright', 'test', '--config', resolve(configPath)], {
      cwd: workdir,
      env: { ...process.env, PLAYWRIGHT_HTML_REPORT: '/dev/null' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout.on('data', chunk => stdoutChunks.push(chunk.toString()));
    child.stderr.on('data', chunk => stderrChunks.push(chunk.toString()));
    // Cinturón y tirantes: hard kill a los 10 minutos.
    const timeout = setTimeout(() => {
      log('WARN', 'Playwright excedió 10 minutos; forzando kill.');
      child.kill('SIGKILL');
    }, 10 * 60 * 1000);
    child.on('close', exitCode => {
      clearTimeout(timeout);
      if (stderrChunks.length) log('WARN', 'stderr: ' + stderrChunks.join('').slice(-800));
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

async function failRun(prisma: PrismaClient, claim: ExecutionClaim, code: string, message: string): Promise<void> {
  await prisma.$transaction(async tx => {
    if (claim.scenarioId) {
      await tx.testResult.create({
        data: {
          runId: claim.id,
          scenarioId: claim.scenarioId,
          status: 'BLOCKED',
          errorMessage: message.slice(0, 4000),
          evidenceKey: null,
        },
      });
    }
    await tx.testRun.update({
      where: { id: claim.id },
      data: { status: 'FAILED', completedAt: new Date(), errorCode: code },
    });
  });
  await settleUsage(prisma, claim, Date.now()).catch(() => {});
}

async function settleUsage(prisma: PrismaClient, claim: ExecutionClaim, startedAt: number): Promise<void> {
  if (!claim.runKey) return;
  const project = await prisma.project.findUnique({ where: { id: claim.projectId }, select: { organizationId: true } });
  if (!project?.organizationId) return;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  await prisma.meteredRun.updateMany({
    where: { organizationId: project.organizationId, runKey: claim.runKey, completedAt: null },
    data: { browserSeconds: elapsedSeconds, completedAt: new Date() },
  });
}

void randomUUID; // re-exportado implícitamente por si lo necesitamos luego

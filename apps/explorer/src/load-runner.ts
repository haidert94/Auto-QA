// Ejecuta una prueba de carga lanzando k6 como subproceso. k6 debe estar
// instalado en el PATH del worker (scripts/explorer-setup.sh lo añade
// desde el repo oficial de Grafana).

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { generateK6Script, parseK6Summary, type LoadStage } from '../../api/src/load/k6-summary';
import { type ScreenshotStorage } from './screenshot-storage';
import { runnableQualityAttempt, suiteAttempt } from './quality-attempt';

export type LoadClaim = {
  id: string;
  projectId: string;
  environmentId: string | null;
  url: string;
  stages: unknown;
  runKey: string | null;
};

type Logger = (level: 'INFO' | 'WARN' | 'ERROR', detail: string) => void;

function coerceStages(raw: unknown): LoadStage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(s => ({
      duration: typeof s.duration === 'string' ? s.duration : '30s',
      target: typeof s.target === 'number' ? s.target : 0,
    }));
}

export async function runLoadTest(
  prisma: PrismaClient, claim: LoadClaim, storage: ScreenshotStorage, log: Logger = () => {}, signal?: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();
  const stages = coerceStages(claim.stages);
  if (!stages.length) {
    await failLoad(prisma, claim, 'no-stages', 'La prueba no tiene stages válidos.');
    return;
  }

  const workdir = await mkdtemp(join(tmpdir(), 'autoqa-load-'));
  const scriptPath = join(workdir, 'load.js');
  const summaryPath = join(workdir, 'summary.json');

  try {
    signal?.throwIfAborted();
    const script = generateK6Script({ url: claim.url, stages, standalone: signal ? { needsQuery: false } : undefined });
    await writeFile(scriptPath, script, { encoding: 'utf8' });
    signal?.throwIfAborted();
    const outcome = await spawnK6(scriptPath, summaryPath, log, signal);
    signal?.throwIfAborted();
    const summaryText = await readFile(summaryPath, 'utf8').catch(() => null);
    const parsed = (() => { try { return summaryText === null ? null : JSON.parse(summaryText); } catch { return null; } })();
    const metrics = parseK6Summary(parsed);
    const summaryKey = summaryText && parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? await storage.put(Buffer.from(summaryText, 'utf8'), { contentType: 'application/json' }) : null;

    const failed = outcome.exitCode !== 0 && (suiteAttempt(claim) || metrics.totalRequests === null);
    await prisma.loadTest.updateMany({
      where: runnableQualityAttempt(claim),
      data: {
        status: failed ? 'FAILED' : 'COMPLETED',
        completedAt: new Date(),
        errorCode: failed ? 'k6-exit-' + outcome.exitCode : null,
        totalRequests: metrics.totalRequests,
        reqPerSec: metrics.reqPerSec,
        failRate: metrics.failRate,
        p50Ms: metrics.p50Ms,
        p95Ms: metrics.p95Ms,
        p99Ms: metrics.p99Ms,
        maxVus: metrics.maxVus,
        durationSec: metrics.durationSec,
        summaryKey,
      },
    });
    await settleUsage(prisma, claim, startedAt);
  } catch (error) {
    if (signal?.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'load-crashed: ' + message);
    await failLoad(prisma, claim, 'load-crashed', message);
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

type SpawnOutcome = { exitCode: number | null };

function spawnK6(scriptPath: string, summaryPath: string, log: Logger, signal?: AbortSignal): Promise<SpawnOutcome> {
  return new Promise(resolve => {
    const child = spawn('k6', [
      'run', '--summary-export', summaryPath, '--quiet', scriptPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', signal, killSignal: 'SIGKILL' });
    const stderr: string[] = [];
    child.stdout.on('data', chunk => { void chunk; });
    child.stderr.on('data', chunk => stderr.push(chunk.toString()));
    // Cinturón y tirantes: hard kill a los 35 minutos (duración máxima
    // declarada 30 min + holgura).
    const timeout = setTimeout(() => {
      log('WARN', 'k6 excedió 35 minutos; kill.');
      child.kill('SIGKILL');
    }, 35 * 60 * 1000);
    child.on('close', exitCode => {
      clearTimeout(timeout);
      if (stderr.length) log('WARN', 'k6 stderr: ' + stderr.join('').slice(-800));
      resolve({ exitCode });
    });
    child.on('error', error => {
      clearTimeout(timeout);
      log('ERROR', 'k6 spawn: ' + (error instanceof Error ? error.message : String(error)));
      resolve({ exitCode: -1 });
    });
  });
}

async function failLoad(prisma: PrismaClient, claim: LoadClaim, code: string, _message: string): Promise<void> {
  await prisma.loadTest.updateMany({
    where: runnableQualityAttempt(claim),
    data: { status: 'FAILED', completedAt: new Date(), errorCode: code },
  }).catch(() => {});
  await settleUsage(prisma, claim, Date.now()).catch(() => {});
}

async function settleUsage(prisma: PrismaClient, claim: LoadClaim, startedAt: number): Promise<void> {
  if (!claim.runKey || suiteAttempt(claim)) return;
  const project = await prisma.project.findUnique({ where: { id: claim.projectId }, select: { organizationId: true } });
  if (!project?.organizationId) return;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  await prisma.meteredRun.updateMany({
    where: { organizationId: project.organizationId, runKey: claim.runKey, completedAt: null },
    data: { browserSeconds: elapsedSeconds, completedAt: new Date() },
  });
}

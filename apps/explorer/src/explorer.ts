// Ejecuta UNA exploración dentro de un navegador Chromium efímero.
// Aplica todos los límites, bloquea requests inseguros y registra evidencia
// y logs en la base de datos. No descubre nuevas URLs todavía (fase 5.3
// visita solo startUrl y recoge la información básica de esa página);
// el BFS queda para una iteración posterior.

import { chromium, type Browser, type BrowserContext, type Request as PwRequest } from 'playwright-core';
import type { PrismaClient, Exploration, Environment } from '@prisma/client';
import { defaultResolver, type GuardScope } from '../../api/src/exploration/url-guard';
import { createCache, decideRequest, type FilterDecision } from './request-filter';
import { LocalScreenshotStorage, type ScreenshotStorage } from './screenshot-storage';

export type RunLimits = {
  maxPages: number;
  perNavigationTimeoutSeconds: number;
  totalBudgetSeconds: number;
  maxResponseBytes: number;
};

const DEFAULTS: RunLimits = {
  maxPages: 20,
  perNavigationTimeoutSeconds: 30,
  totalBudgetSeconds: 120,
  maxResponseBytes: 5_000_000,
};

function readLimits(raw: unknown): RunLimits {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const pick = <K extends keyof RunLimits>(key: K): number => {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULTS[key];
  };
  return {
    maxPages: Math.min(Math.max(Math.floor(pick('maxPages')), 1), 200),
    perNavigationTimeoutSeconds: Math.min(Math.max(Math.floor(pick('perNavigationTimeoutSeconds')), 5), 600),
    totalBudgetSeconds: Math.min(Math.max(Math.floor(pick('totalBudgetSeconds')), 30), 3600),
    maxResponseBytes: Math.min(Math.max(Math.floor(pick('maxResponseBytes')), 1024), 50_000_000),
  };
}

function scopeFromEnvironment(env: Pick<Environment, 'allowedHosts' | 'allowedPaths' | 'excludedPaths'>): GuardScope {
  const toStrings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    allowedHosts: toStrings(env.allowedHosts),
    allowedPaths: toStrings(env.allowedPaths),
    excludedPaths: toStrings(env.excludedPaths),
  };
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR';
type Logger = (level: LogLevel, code: string, detail?: string) => Promise<void>;

async function withLogger(prisma: PrismaClient, explorationId: string): Promise<Logger> {
  return async (level, code, detail) => {
    await prisma.explorationLog.create({ data: { explorationId, level, code, detail: detail?.slice(0, 1000) } });
  };
}

export async function runExploration(
  prisma: PrismaClient,
  exploration: Exploration,
  environment: Pick<Environment, 'allowedHosts' | 'allowedPaths' | 'excludedPaths'>,
  storage: ScreenshotStorage = new LocalScreenshotStorage(),
): Promise<void> {
  const limits = readLimits(exploration.limits);
  const scope = scopeFromEnvironment(environment);
  const log = await withLogger(prisma, exploration.id);
  const cache = createCache();
  const deadline = Date.now() + limits.totalBudgetSeconds * 1000;
  const startedAt = Date.now();

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
    });
    context = await browser.newContext({
      javaScriptEnabled: true,
      acceptDownloads: false,
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      viewport: { width: 1280, height: 800 },
      userAgent: 'AutoQA/0.5 (+exploration; read-only)',
      permissions: [],
      geolocation: undefined,
      extraHTTPHeaders: {},
    });

    // Interceptor universal: cada request (incluidas redirecciones) pasa por aquí.
    await context.route('**/*', async route => {
      const request = route.request();
      const decision: FilterDecision = await decideRequest(
        { url: request.url(), method: request.method(), resourceType: request.resourceType() },
        scope,
        cache,
        defaultResolver,
      );
      if (!decision.allow) {
        await log('WARN', decision.code, request.method() + ' ' + request.url());
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    context.on('page', page => {
      page.on('popup', async popup => {
        await log('WARN', 'popup-blocked', popup.url());
        await popup.close().catch(() => {});
      });
    });

    const page = await context.newPage();
    const visited = new Set<string>();
    const queue: string[] = [exploration.startUrl];
    let position = 0;

    while (queue.length && visited.size < limits.maxPages) {
      if (Date.now() > deadline) {
        await log('WARN', 'budget-exceeded', 'totalBudget=' + limits.totalBudgetSeconds + 's');
        break;
      }

      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: limits.perNavigationTimeoutSeconds * 1000,
        });

        const httpStatus = response?.status() ?? null;
        const title = await page.title().catch(() => '');
        const dom = await page.content().catch(() => '');
        const domSize = dom.length;

        if (domSize > limits.maxResponseBytes) {
          await log('WARN', 'dom-too-large', `${domSize} > ${limits.maxResponseBytes}`);
        }

        let screenshotKey: string | null = null;
        try {
          const buffer = await page.screenshot({ fullPage: false, type: 'png' });
          screenshotKey = await storage.put(Buffer.from(buffer));
        } catch (error) {
          await log('WARN', 'screenshot-failed', error instanceof Error ? error.message : undefined);
        }

        position += 1;
        await prisma.explorationPage.create({
          data: {
            explorationId: exploration.id,
            position, url,
            httpStatus: httpStatus ?? undefined,
            title: title?.slice(0, 500) || null,
            domSize,
            screenshotKey,
          },
        });
        await log('INFO', 'page-visited', (httpStatus ?? 'noresp') + ' ' + url);
      } catch (error) {
        await log('ERROR', 'navigation-failed', error instanceof Error ? error.message : undefined);
      }
    }

    await prisma.exploration.update({
      where: { id: exploration.id },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });
    await settleUsage(prisma, exploration, startedAt);
  } catch (error) {
    await log('ERROR', 'worker-crashed', error instanceof Error ? error.message : undefined);
    await prisma.exploration.update({
      where: { id: exploration.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorCode: 'worker-crashed' },
    });
    await settleUsage(prisma, exploration, startedAt);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  // avoid unused import tree-shake complaints
  void (null as PwRequest | null);
}

// Equivalente a UsageService.settleRun pero sin NestJS: el worker no está en
// el DI container y solo necesita contabilizar los segundos reales usados.
async function settleUsage(prisma: PrismaClient, exploration: Exploration, startedAt: number): Promise<void> {
  const runKey = (exploration as { runKey?: string | null }).runKey;
  if (!runKey) return;
  const project = await prisma.project.findUnique({
    where: { id: exploration.projectId }, select: { organizationId: true },
  });
  if (!project?.organizationId) return;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  await prisma.meteredRun.updateMany({
    where: { organizationId: project.organizationId, runKey, completedAt: null },
    data: { browserSeconds: elapsedSeconds, completedAt: new Date() },
  });
}

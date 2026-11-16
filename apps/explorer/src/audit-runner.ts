// Ejecuta una auditoría Lighthouse contra una URL autorizada:
// lanza Chromium headless (chrome-launcher), llama a la librería Lighthouse,
// parsea el reporte y guarda las métricas y el JSON crudo.

import type { PrismaClient } from '@prisma/client';
import { parseLighthouseReport, type LighthouseMetrics } from '../../api/src/performance/lighthouse-report';
import { type ScreenshotStorage } from './screenshot-storage';

// chrome-launcher v1 y lighthouse v12 son ESM; el explorer está en CJS
// (Node16 module). Los cargamos con import() dinámico.
type LaunchedChrome = { port: number; kill(): Promise<void> };

export type AuditClaim = {
  id: string;
  projectId: string;
  environmentId: string | null;
  url: string;
  runKey: string | null;
};

type Logger = (level: 'INFO' | 'WARN' | 'ERROR', detail: string) => void;

export async function runAudit(
  prisma: PrismaClient,
  claim: AuditClaim,
  storage: ScreenshotStorage,
  log: Logger = () => {},
): Promise<void> {
  const startedAt = Date.now();
  let chrome: LaunchedChrome | null = null;
  try {
    const launcherModule = await import('chrome-launcher');
    const launch = (launcherModule as unknown as {
      launch: (opts: unknown) => Promise<LaunchedChrome>;
    }).launch;
    chrome = await launch({
      chromeFlags: [
        '--headless=new',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    // Importamos dinámicamente para no cargar Lighthouse en memoria si el
    // worker nunca procesa audits.
    const imported = await import('lighthouse');
    const lighthouseFn = ((imported as unknown as { default?: unknown }).default ?? imported) as (
      url: string, opts: unknown,
    ) => Promise<{ lhr: unknown; report: string | string[] } | undefined>;
    const result = await lighthouseFn(claim.url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });
    if (!result) throw new Error('Lighthouse no produjo resultado.');
    const metrics: LighthouseMetrics = parseLighthouseReport(result.lhr);
    const reportText = Array.isArray(result.report) ? result.report[0] : result.report;
    const reportKey = await storage.put(Buffer.from(reportText, 'utf8'), { contentType: 'application/json' });

    await prisma.performanceAudit.update({
      where: { id: claim.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        performanceScore: metrics.performanceScore,
        accessibilityScore: metrics.accessibilityScore,
        bestPracticesScore: metrics.bestPracticesScore,
        seoScore: metrics.seoScore,
        fcpMs: metrics.fcpMs, lcpMs: metrics.lcpMs, tbtMs: metrics.tbtMs,
        cls: metrics.cls, siMs: metrics.siMs,
        reportKey,
      },
    });
    await settleUsage(prisma, claim, startedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'audit-crashed: ' + message);
    await prisma.performanceAudit.update({
      where: { id: claim.id },
      data: { status: 'FAILED', completedAt: new Date(), errorCode: 'audit-failed' },
    }).catch(() => {});
    await settleUsage(prisma, claim, startedAt).catch(() => {});
  } finally {
    if (chrome) { try { await chrome.kill(); } catch {} }
  }
}

async function settleUsage(prisma: PrismaClient, claim: AuditClaim, startedAt: number): Promise<void> {
  if (!claim.runKey) return;
  const project = await prisma.project.findUnique({ where: { id: claim.projectId }, select: { organizationId: true } });
  if (!project?.organizationId) return;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  await prisma.meteredRun.updateMany({
    where: { organizationId: project.organizationId, runKey: claim.runKey, completedAt: null },
    data: { browserSeconds: elapsedSeconds, completedAt: new Date() },
  });
}

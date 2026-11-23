// Ejecuta una auditoría UX asistida por IA sobre una URL autorizada:
// 1. abre la URL con Playwright, captura screenshot y árbol a11y simplificado.
// 2. llama al AiRouter (operación ux-analysis) con heurísticas Nielsen +
//    WCAG básico pidiendo hallazgos categorizados.
// 3. guarda el reporte en ScreenshotStorage y los agregados en UxAudit.

import type { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
import { type AiRouter } from '../../api/src/ai/ai-router';
import { buildUxPrompt, summarizeUxDom, UX_NAVIGATION_TIMEOUT_MS, UX_SYSTEM_PROMPT, UX_VIEWPORT } from '../../api/src/ux/ux-evidence';
import { type ScreenshotStorage } from './screenshot-storage';
import { runnableQualityAttempt } from './quality-attempt';

export type UxAuditClaim = {
  id: string;
  projectId: string;
  environmentId: string | null;
  url: string;
  runKey: string | null;
};

type Logger = (level: 'INFO' | 'WARN' | 'ERROR', detail: string) => void;

type Finding = {
  heuristic?: string;
  severity?: 'critical' | 'major' | 'minor';
  summary?: string;
  recommendation?: string;
  selector?: string;
};

type UxReport = { findings?: Finding[]; overallSummary?: string };

export async function runUxAudit(
  prisma: PrismaClient, claim: UxAuditClaim, storage: ScreenshotStorage,
  router: AiRouter, log: Logger = () => {}, signal?: AbortSignal,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: claim.projectId }, select: { organizationId: true },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  function stopBrowser() { void browser?.close().catch(() => {}); }
  signal?.addEventListener('abort', stopBrowser, { once: true });
  try {
    // --no-sandbox es necesario en VPS sin kernel.apparmor_restrict_unprivileged_userns=0.
    // Sin esto, Chrome aborta con "waiting for dynamic debugging port in
    // chrome-err.log" durante el launch.
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: false,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
    });
    signal?.throwIfAborted();
    const context = await browser.newContext({ viewport: UX_VIEWPORT });
    const page = await context.newPage();
    await page.goto(claim.url, { waitUntil: 'networkidle', timeout: UX_NAVIGATION_TIMEOUT_MS });

    const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
    // Resumen del DOM: encabezados, botones, enlaces, inputs, imágenes sin
    // alt — suficiente para que la IA valore accesibilidad básica.
    const domSummary = await page.evaluate(summarizeUxDom).catch(() => ({}));

    await browser.close();
    browser = null;

    signal?.throwIfAborted();
    const prompt = buildUxPrompt(claim.url, domSummary);

    const response = await router.dispatch({
      operation: 'ux-analysis',
      organizationId: project?.organizationId ?? null,
      projectId: claim.projectId,
      runKey: claim.runKey,
      prompt,
      systemPrompt: UX_SYSTEM_PROMPT,
      maxOutputTokens: 3000,
    });

    signal?.throwIfAborted();
    const parsed = parseReport(response.text);
    const findings = (parsed.findings ?? []).slice(0, 25);
    const counts = tallySeverities(findings);
    const screenshotKey = await storage.put(screenshot, { contentType: 'image/png' });
    const reportKey = await storage.put(Buffer.from(JSON.stringify({
      ...parsed, findings, screenshotKey, model: response.model,
    }, null, 2), 'utf8'), { contentType: 'application/json' });

    await prisma.uxAudit.updateMany({
      where: runnableQualityAttempt(claim),
      data: {
        status: 'COMPLETED', completedAt: new Date(),
        totalFindings: findings.length,
        criticalCount: counts.critical, majorCount: counts.major, minorCount: counts.minor,
        reportKey,
      },
    });
    log('INFO', 'ux ok · findings=' + findings.length + ' c=' + counts.critical + ' M=' + counts.major + ' m=' + counts.minor);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    if (signal?.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'ux-crashed: ' + message);
    await prisma.uxAudit.updateMany({
      where: runnableQualityAttempt(claim),
      data: { status: 'FAILED', completedAt: new Date(), errorCode: message.slice(0, 120) },
    }).catch(() => {});
  } finally {
    signal?.removeEventListener('abort', stopBrowser);
  }
}

function parseReport(text: string): UxReport {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start < 0) return {};
  try { return JSON.parse(body.slice(start)) as UxReport; }
  catch {
    const end = body.lastIndexOf('}');
    if (end > start) {
      try { return JSON.parse(body.slice(start, end + 1)) as UxReport; }
      catch { return {}; }
    }
    return {};
  }
}

function tallySeverities(findings: Finding[]): { critical: number; major: number; minor: number } {
  let critical = 0, major = 0, minor = 0;
  for (const f of findings) {
    if (f.severity === 'critical') critical += 1;
    else if (f.severity === 'major') major += 1;
    else if (f.severity === 'minor') minor += 1;
  }
  return { critical, major, minor };
}

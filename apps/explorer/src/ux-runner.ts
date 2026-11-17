/// <reference lib="dom" />
// Ejecuta una auditoría UX asistida por IA sobre una URL autorizada:
// 1. abre la URL con Playwright, captura screenshot y árbol a11y simplificado.
// 2. llama al AiRouter (operación ux-analysis) con heurísticas Nielsen +
//    WCAG básico pidiendo hallazgos categorizados.
// 3. guarda el reporte en ScreenshotStorage y los agregados en UxAudit.

import type { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
import { type AiRouter } from '../../api/src/ai/ai-router';
import { type ScreenshotStorage } from './screenshot-storage';

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

const HEURISTICS = [
  'H1 visibilidad del estado del sistema',
  'H2 lenguaje natural y del usuario',
  'H3 control y libertad',
  'H4 consistencia y estándares',
  'H5 prevención de errores',
  'H6 reconocimiento mejor que recuerdo',
  'H7 flexibilidad y eficiencia',
  'H8 diseño estético y minimalista',
  'H9 ayuda a reconocer errores',
  'H10 ayuda y documentación',
  'WCAG contraste, foco visible, textos alternativos, jerarquía semántica',
];

export async function runUxAudit(
  prisma: PrismaClient, claim: UxAuditClaim, storage: ScreenshotStorage,
  router: AiRouter, log: Logger = () => {},
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: claim.projectId }, select: { organizationId: true },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(claim.url, { waitUntil: 'networkidle', timeout: 30000 });

    const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
    // Resumen del DOM: encabezados, botones, enlaces, inputs, imágenes sin
    // alt — suficiente para que la IA valore accesibilidad básica.
    const domSummary = await page.evaluate(() => {
      const trim = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const pick = (sel: string, max: number) => Array.from(document.querySelectorAll(sel)).slice(0, max);
      return {
        title: document.title,
        lang: document.documentElement.lang,
        headings: pick('h1,h2,h3', 30).map(h => ({ tag: h.tagName.toLowerCase(), text: trim(h.textContent) })),
        buttons: pick('button,[role=button]', 30).map(b => ({ text: trim(b.textContent), aria: (b as HTMLElement).getAttribute('aria-label') })),
        links: pick('a[href]', 30).map(a => ({ text: trim(a.textContent), href: (a as HTMLAnchorElement).href.slice(0, 200) })),
        inputs: pick('input,select,textarea', 30).map(i => ({
          type: (i as HTMLInputElement).type ?? i.tagName.toLowerCase(),
          name: (i as HTMLInputElement).name,
          aria: i.getAttribute('aria-label'),
          placeholder: (i as HTMLInputElement).placeholder,
          hasLabel: !!(i.id && document.querySelector('label[for="' + i.id + '"]')),
        })),
        imagesMissingAlt: pick('img:not([alt])', 10).length,
      };
    }).catch(() => ({}));

    await browser.close();
    browser = null;

    const prompt = [
      'Audita la siguiente página web aplicando heurísticas de Nielsen y pautas WCAG básicas.',
      'Heurísticas a considerar:',
      HEURISTICS.map(h => '- ' + h).join('\n'),
      '',
      'URL: ' + claim.url,
      '',
      'Resumen del DOM (encabezados, botones, enlaces, inputs):',
      JSON.stringify(domSummary).slice(0, 20000),
      '',
      'Responde SOLO JSON con el formato:',
      '{ "overallSummary": "...", "findings": [ { "heuristic": "H4", "severity": "critical|major|minor", "summary": "...", "recommendation": "...", "selector": "css opcional" } ] }',
      'Máximo 15 findings. Clasifica severity por impacto real en el usuario.',
    ].join('\n');

    const response = await router.dispatch({
      operation: 'ux-analysis',
      organizationId: project?.organizationId ?? null,
      projectId: claim.projectId,
      runKey: claim.runKey,
      prompt,
      systemPrompt: 'Experto en usabilidad y accesibilidad web. SOLO JSON válido.',
      maxOutputTokens: 3000,
    });

    const parsed = parseReport(response.text);
    const findings = (parsed.findings ?? []).slice(0, 25);
    const counts = tallySeverities(findings);
    const screenshotKey = await storage.put(screenshot, { contentType: 'image/png' });
    const reportKey = await storage.put(Buffer.from(JSON.stringify({
      ...parsed, findings, screenshotKey, model: response.model,
    }, null, 2), 'utf8'), { contentType: 'application/json' });

    await prisma.uxAudit.update({
      where: { id: claim.id },
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
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'ux-crashed: ' + message);
    await prisma.uxAudit.update({
      where: { id: claim.id },
      data: { status: 'FAILED', completedAt: new Date(), errorCode: message.slice(0, 120) },
    }).catch(() => {});
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

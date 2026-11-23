/// <reference lib="dom" />

import { extractJson } from '../../automation/agents/agent-types';
import { summarizeUxDom, UX_NAVIGATION_TIMEOUT_MS, UX_PROMPT_DOM, UX_PROMPT_END, UX_PROMPT_START, UX_SYSTEM_PROMPT, UX_VIEWPORT } from '../../ux/ux-evidence';
import { nodeTarget, QualityReviewRequired, type UxAgentContext } from './agent-context';

const checkLabels = {
  'page-language': 'Idioma declarado en la página',
  'heading-order': 'Jerarquía de encabezados',
  'form-labels': 'Etiquetas de los controles de formulario',
  'image-alternatives': 'Imágenes con texto alternativo declarado',
} as const;

type UxCheck = keyof typeof checkLabels;
const defaultChecks = Object.keys(checkLabels) as UxCheck[];

function pageType(pathname: string) {
  if (/(?:^|\/)(?:login|registro|checkout|formulario|sign-in)(?:\/|$)/i.test(pathname)) return 'Formulario';
  if (/(?:^|\/)(?:catalogo|catalog|products|productos|inventory)(?:\/|$)/i.test(pathname)) return 'Catálogo';
  return 'Página general';
}

function validateChecks(value: unknown): UxCheck[] {
  if (!Array.isArray(value) || !value.length || value.length > defaultChecks.length
    || !value.every((check): check is UxCheck => typeof check === 'string' && Object.hasOwn(checkLabels, check))) {
    throw new QualityReviewRequired('El agente UX no pudo definir comprobaciones válidas. Vuelve a generar el archivo.');
  }
  return [...new Set(value)];
}

export async function prepareUx(url: URL, context: UxAgentContext) {
  // Solo se envía una categoría conocida. Las URL y los datos del entorno se quedan en AutoQA.
  const prompt = [
    'Prioriza comprobaciones de accesibilidad para el escenario de auditoría UX.',
    'Tipo de página: ' + pageType(url.pathname),
    'Identificadores permitidos: ' + JSON.stringify(checkLabels),
    'Devuelve solo un objeto JSON con el campo checks, una lista de identificadores de la tabla.',
  ].join('\n');

  const result = await context.ai.dispatch({
    operation: 'ux-analysis',
    organizationId: context.organizationId,
    projectId: context.projectId,
    runKey: null,
    prompt,
    systemPrompt: 'Selecciona comprobaciones de accesibilidad. Devuelve solo JSON. Usa únicamente los identificadores permitidos.',
    maxOutputTokens: 160,
    timeoutMs: 8000,
  });
  const checks = result.usedFallback ? defaultChecks : validateChecks(extractJson<{ checks?: unknown }>(result.text)?.checks);
  return renderUxFile(url, checks);
}

// Playwright serializa esta función para ejecutarla en el navegador. Devuelve conteos, no datos de formularios.
function collectChecks(checks: UxCheck[]) {
  return checks.map(check => {
    switch (check) {
      case 'page-language':
        return { check, observations: document.documentElement.lang.trim() ? 0 : 1 };
      case 'heading-order': {
        const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'), element => Number(element.tagName.slice(1)));
        return { check, observations: levels.filter((level, index) => index > 0 && level > levels[index - 1] + 1).length };
      }
      case 'form-labels': {
        const controls = Array.from(document.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),select,textarea'));
        return {
          check,
          observations: controls.filter(control => !control.labels?.length
            && !control.getAttribute('aria-label')?.trim() && !control.getAttribute('aria-labelledby')?.trim()).length,
        };
      }
      case 'image-alternatives':
        return { check, observations: document.querySelectorAll('img:not([alt])').length };
    }
  });
}

export function renderUxFile(url: URL, checks: UxCheck[] = defaultChecks) {
  return [
    '// Requiere Playwright con Chromium. Los conteos son evidencias para el análisis Nielsen y WCAG.',
    "import { chromium } from 'playwright';",
    "import { writeFile } from 'node:fs/promises';",
    '',
    ...nodeTarget(url),
    'const browser = await chromium.launch({ headless: true, chromiumSandbox: true });',
    'try {',
    '  const page = await browser.newPage({ viewport: ' + JSON.stringify(UX_VIEWPORT) + ' });',
    "  await page.goto(target.href, { waitUntil: 'networkidle', timeout: " + UX_NAVIGATION_TIMEOUT_MS + ' });',
    "  await page.screenshot({ fullPage: true, path: 'ux-captura.png' });",
    '  const checks = await page.evaluate(' + collectChecks.toString() + ', ' + JSON.stringify(checks) + ');',
    "  await writeFile('ux-comprobaciones.json', JSON.stringify(checks, null, 2));",
    '  const dom = await page.evaluate(' + summarizeUxDom.toString() + ');',
    '  const prompt = ' + JSON.stringify(UX_SYSTEM_PROMPT + '\n\n' + UX_PROMPT_START)
      + ' + target.origin + target.pathname + ' + JSON.stringify('\n' + UX_PROMPT_DOM)
      + ' + JSON.stringify({ dom, checks }).slice(0, 20000) + ' + JSON.stringify('\n' + UX_PROMPT_END) + ';',
    "  await writeFile('ux-prompt.txt', prompt);",
    '} finally {',
    '  await browser.close();',
    '}',
    '',
  ].join('\n');
}

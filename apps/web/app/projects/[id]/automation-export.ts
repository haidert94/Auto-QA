import type { ScenarioListItem } from './scenario-card';

export type GeneratedSpec = {
  scenarioId: string; title: string; filename: string; code: string; signature: string;
  review: string[]; error?: string; automationId?: string | null; notice?: string;
};

export function scenarioSpecSignature(scenario: ScenarioListItem) {
  return JSON.stringify([scenario.title, scenario.expectedResult, scenario.steps]);
}

export const playwrightConfig = [
  "import { defineConfig } from '@playwright/test';", '',
  '// Define AUTOQA_BASE_URL sólo para un entorno cuyo alcance hayas autorizado.',
  'export default defineConfig({', "  testDir: './tests',", '  fullyParallel: false,',
  '  workers: 1,', '  retries: 0,', '  use: {', '    baseURL: process.env.AUTOQA_BASE_URL,',
  "    trace: 'retain-on-failure',", "    screenshot: 'only-on-failure',", '  },', '});', '',
].join('\n');

export function specFilename(filename: string, id: string) {
  const leaf = filename.split(/[\\/]/).at(-1) ?? '';
  const safe = leaf.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 150);
  return safe.endsWith('.spec.ts') && safe.length > 8 ? safe : `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.spec.ts`;
}

export function specPath(spec: GeneratedSpec) {
  return `tests/${spec.scenarioId.replace(/[^a-zA-Z0-9_-]/g, '')}/${specFilename(spec.filename, spec.scenarioId)}`;
}

export async function downloadSpecs(projectName: string, specs: GeneratedSpec[]) {
  const { default: JSZip } = await import('jszip');
  const archive = new JSZip();
  for (const spec of specs) archive.file(specPath(spec), spec.code);
  archive.file('playwright.config.ts', playwrightConfig);
  archive.file('README.md', [
    '# AutoQA — exportación Playwright', '', `Proyecto: ${projectName}`, '',
    'Código generado mecánicamente desde escenarios guardados; no implica compilación ni ejecución verificada.',
    'Revisa los pasos, aserciones, selectores, datos y alcance antes de ejecutar. No se incluyen credenciales.', '',
    'Instala @playwright/test en tu proyecto e instala los navegadores de Playwright según su documentación.',
    'En PowerShell configura $env:AUTOQA_BASE_URL con un entorno HTTPS autorizado.',
    'Después de revisar el código, ejecuta npx.cmd playwright test.', '',
    'Esta configuración es para exportación local. Las ejecuciones en AutoQA conservan sus controles del backend y worker.', '',
    'Archivos:', ...specs.map(spec => `- ${specPath(spec)}${spec.review.length ? ' — Revisar: ' + spec.review.join('; ') : ''}`), '',
  ].join('\n'));
  const blob = await archive.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'autoqa-playwright.zip'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

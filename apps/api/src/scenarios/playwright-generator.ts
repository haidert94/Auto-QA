// Convierte un TestScenario en un spec de @playwright/test en TypeScript.
// Mecanico, sin IA: reconoce un vocabulario pequeno de prefijos en el campo
// "action" y emite la llamada Playwright correspondiente. Lo que no case se
// traduce a un `// TODO:` con el texto original para que el autor lo
// complete antes de correr la prueba.
//
// Seguridad: todo string interpolado se escapa como literal JS para evitar
// inyeccion de codigo. Nunca pegamos texto crudo del usuario en el spec.

export type GeneratorStep = {
  ordinal: number;
  action: string;
  data?: string | null;
  expected?: string | null;
};

export type GeneratorScenario = {
  id: string;
  title: string;
  expectedResult?: string | null;
  steps: GeneratorStep[];
};

// Escape conservador para literales de string con comillas simples.
// Cubre backslash, comillas simples, newlines/tabs/retornos y los separadores
// Unicode U+2028/U+2029 (que romperian un literal de string JS).
const LINE_SEPARATOR = new RegExp('[\\u2028\\u2029]', 'g');
export function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(LINE_SEPARATOR, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

// Particion simple: toma un prefijo "<verbo>:" y devuelve { verb, rest }.
function splitAction(raw: string): { verb: string; rest: string } | null {
  const idx = raw.indexOf(':');
  if (idx < 0) return null;
  const verb = raw.slice(0, idx).trim().toLowerCase();
  const rest = raw.slice(idx + 1).trim();
  if (!verb || !rest) return null;
  return { verb, rest };
}

function commentLines(text: string, indent: string): string[] {
  return text.split(/\r?\n/).map(line => indent + '// ' + line);
}

export function generateStepLines(step: GeneratorStep, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}// Paso ${step.ordinal}: ${step.action.split(/\r?\n/)[0]}`);
  if (step.expected && step.expected.trim()) {
    lines.push(...commentLines('Esperado: ' + step.expected.trim(), indent));
  }

  const parsed = splitAction(step.action);
  if (!parsed) {
    lines.push(`${indent}// TODO: ${step.action}`);
    return lines;
  }

  const { verb, rest } = parsed;
  switch (verb) {
    case 'navigate':
    case 'goto':
    case 'open':
      lines.push(`${indent}await page.goto('${escapeJsString(rest)}');`);
      break;
    case 'click':
      lines.push(`${indent}await page.locator('${escapeJsString(rest)}').click();`);
      break;
    case 'fill':
      lines.push(`${indent}await page.locator('${escapeJsString(rest)}').fill('${escapeJsString(step.data ?? '')}');`);
      break;
    case 'press':
    case 'key':
      lines.push(`${indent}await page.keyboard.press('${escapeJsString(rest)}');`);
      break;
    case 'expect-text':
    case 'expect text':
      lines.push(`${indent}await expect(page.getByText('${escapeJsString(rest)}')).toBeVisible();`);
      break;
    case 'expect-url':
    case 'expect url':
      lines.push(`${indent}await expect(page).toHaveURL('${escapeJsString(rest)}');`);
      break;
    default:
      lines.push(`${indent}// TODO (verbo "${verb}" no reconocido): ${step.action}`);
  }
  return lines;
}

export function generateSpec(scenario: GeneratorScenario): string {
  const title = escapeJsString(scenario.title);
  const lines: string[] = [];
  lines.push("import { expect, test } from '@playwright/test';");
  lines.push('');
  lines.push(`// Escenario AutoQA ${scenario.id}`);
  if (scenario.expectedResult && scenario.expectedResult.trim()) {
    lines.push(...commentLines('Resultado esperado: ' + scenario.expectedResult.trim(), ''));
  }
  lines.push('');
  lines.push(`test('${title}', async ({ page }) => {`);
  if (scenario.steps.length === 0) {
    lines.push('  // TODO: define los pasos del escenario en AutoQA.');
  } else {
    for (const step of scenario.steps) {
      lines.push(...generateStepLines(step, '  '));
      lines.push('');
    }
    if (scenario.expectedResult && scenario.expectedResult.trim()) {
      lines.push('  // Validacion final sugerida (completar si aplica):');
      lines.push(`  // await expect(page.getByText('${escapeJsString(scenario.expectedResult.trim())}')).toBeVisible();`);
    }
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

export type HarnessEnvironment = {
  baseUrl: string | null;
  allowedHosts: string[];
  allowedPaths: string[];
  excludedPaths: string[];
};

export type HarnessTarget = {
  // CHROMIUM | FIREFOX | WEBKIT. Null = CHROMIUM por compatibilidad.
  browser?: string | null;
  // Nombre de un preset de Playwright: 'iPhone 13', 'Pixel 7', etc. Null = desktop.
  device?: string | null;
};

// Lista blanca de dispositivos soportados; coincide con los presets estables
// de Playwright. La UI la usa para poblar el dropdown; el worker la valida
// antes de inyectarla en el spec.
export const SUPPORTED_DEVICES = [
  'Desktop Chrome', 'Desktop Firefox', 'Desktop Safari', 'Desktop Edge',
  'iPhone 13', 'iPhone 14', 'iPhone 15', 'iPhone SE',
  'Pixel 5', 'Pixel 7', 'Galaxy S9+',
  'iPad (gen 7)', 'iPad Pro 11',
] as const;

export const SUPPORTED_BROWSERS = ['CHROMIUM', 'FIREFOX', 'WEBKIT'] as const;

export const SUPPORTED_PROVIDERS = ['LOCAL', 'BROWSERSTACK'] as const;

export function isSupportedProvider(name: string | null | undefined): boolean {
  if (!name) return true;
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(name);
}

// Construye el wsEndpoint de Playwright-over-CDP de BrowserStack a partir de
// un conjunto de capacidades. El `userName` y `accessKey` van dentro del
// JSON de caps; BrowserStack los extrae de ahí (no usa Basic auth del URL).
export function buildBrowserstackWsEndpoint(options: {
  userName: string;
  accessKey: string;
  browser?: string | null;
  device?: string | null;
  projectName?: string;
  buildName?: string;
  sessionName?: string;
}): string {
  const caps: Record<string, unknown> = {
    'browserstack.username': options.userName,
    'browserstack.accessKey': options.accessKey,
    browser: (options.browser ?? 'CHROMIUM').toLowerCase() === 'firefox' ? 'playwright-firefox'
      : (options.browser ?? 'CHROMIUM').toLowerCase() === 'webkit' ? 'playwright-webkit'
      : 'playwright-chromium',
    browser_version: 'latest',
    os: 'osx',
    os_version: 'Ventura',
    name: options.sessionName ?? 'AutoQA scenario',
    build: options.buildName ?? 'AutoQA',
    project: options.projectName ?? 'AutoQA',
  };
  if (options.device) caps.deviceName = options.device;
  return 'wss://cdp.browserstack.com/playwright?caps=' + encodeURIComponent(JSON.stringify(caps));
}

export function isSupportedDevice(name: string | null | undefined): boolean {
  if (!name) return true;
  return (SUPPORTED_DEVICES as readonly string[]).includes(name);
}

export function isSupportedBrowser(name: string | null | undefined): boolean {
  if (!name) return true;
  return (SUPPORTED_BROWSERS as readonly string[]).includes(name);
}

// Spec "con arnes" para el worker: incluye configuracion Playwright embebida,
// baseURL del entorno y un test.beforeEach que aplica el mismo filtro de
// url-guard que usa la exploracion (lista de hosts permitida, paths vetados,
// prohibicion de IPs literales, redireccion forzada por scope).
export function generateHarnessedSpec(
  scenario: GeneratorScenario, env: HarnessEnvironment, target: HarnessTarget = {},
): string {
  const title = escapeJsString(scenario.title);
  const baseURL = env.baseUrl ? escapeJsString(env.baseUrl) : '';
  const hosts = env.allowedHosts.map(h => `'${escapeJsString(h)}'`).join(', ');
  const allowed = env.allowedPaths.map(p => `'${escapeJsString(p)}'`).join(', ');
  const excluded = env.excludedPaths.map(p => `'${escapeJsString(p)}'`).join(', ');
  const device = isSupportedDevice(target.device) ? (target.device ?? null) : null;

  const lines: string[] = [];
  if (device) {
    lines.push("import { devices, expect, test } from '@playwright/test';");
  } else {
    lines.push("import { expect, test } from '@playwright/test';");
  }
  lines.push('');
  if (device) {
    lines.push(`test.use({ ...devices['${escapeJsString(device)}'], baseURL: '${baseURL}' });`);
  } else {
    lines.push(`test.use({ baseURL: '${baseURL}' });`);
  }
  lines.push('');
  lines.push('// Filtro de requests: idéntico contrato que la exploración.');
  lines.push('// Bloquea hosts fuera del allowlist, paths excluidos y esquemas no HTTP(S).');
  lines.push(`const ALLOWED_HOSTS = new Set<string>([${hosts}]);`);
  lines.push(`const ALLOWED_PATHS: string[] = [${allowed}];`);
  lines.push(`const EXCLUDED_PATHS: string[] = [${excluded}];`);
  lines.push('');
  lines.push('function hostAllowed(host: string): boolean {');
  lines.push('  if (ALLOWED_HOSTS.has(host)) return true;');
  lines.push('  for (const allowed of ALLOWED_HOSTS) {');
  lines.push("    if (allowed.startsWith('*.')) {");
  lines.push('      const suffix = allowed.slice(1);');
  lines.push('      if (host.endsWith(suffix) && host.length > suffix.length) return true;');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return false;');
  lines.push('}');
  lines.push('');
  lines.push('function pathAllowed(pathname: string): boolean {');
  lines.push('  if (EXCLUDED_PATHS.some(p => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"))) return false;');
  lines.push('  if (ALLOWED_PATHS.length === 0) return true;');
  lines.push('  return ALLOWED_PATHS.some(p => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"));');
  lines.push('}');
  lines.push('');
  lines.push('test.beforeEach(async ({ context }) => {');
  lines.push("  await context.route('**/*', async route => {");
  lines.push('    const request = route.request();');
  lines.push('    let target: URL;');
  lines.push('    try { target = new URL(request.url()); }');
  lines.push("    catch { await route.abort('blockedbyclient'); return; }");
  lines.push("    if (!['http:', 'https:'].includes(target.protocol)) { await route.abort('blockedbyclient'); return; }");
  lines.push("    if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(target.hostname)) { await route.abort('blockedbyclient'); return; }");
  lines.push("    if (!hostAllowed(target.hostname)) { await route.abort('blockedbyclient'); return; }");
  lines.push("    if (!pathAllowed(target.pathname)) { await route.abort('blockedbyclient'); return; }");
  lines.push('    await route.continue();');
  lines.push('  });');
  lines.push('});');
  lines.push('');
  lines.push(`test('${title}', async ({ page }) => {`);
  if (scenario.steps.length === 0) {
    lines.push('  // Escenario sin pasos: nada que ejecutar.');
  } else {
    for (const step of scenario.steps) {
      lines.push(...generateStepLines(step, '  '));
      lines.push('');
    }
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

// Config mínimo para que el worker arranque Playwright con trace y
// resultados JSON legibles. Se escribe al lado del spec en el directorio
// temporal de la ejecución. `browser` elige el motor del "project"; default
// chromium para no romper los runs previos. `wsEndpoint` opcional hace que
// Playwright se conecte a un browser REMOTO (BrowserStack u otro provider
// compatible con el protocolo CDP) en vez de lanzar uno local.
export function generatePlaywrightConfig(options: {
  outputDir: string;
  browser?: string | null;
  wsEndpoint?: string | null;
}): string {
  const projectName = (options.browser ?? 'CHROMIUM').toLowerCase();
  const engine = projectName === 'firefox' ? 'firefox' : projectName === 'webkit' ? 'webkit' : 'chromium';
  const useBlock = options.wsEndpoint
    ? [
      "    headless: true,",
      "    trace: 'on',",
      "    screenshot: 'only-on-failure',",
      "    video: 'off',",
      '    actionTimeout: 15000,',
      '    navigationTimeout: 30000,',
      '    connectOptions: {',
      `      wsEndpoint: '${escapeJsString(options.wsEndpoint)}',`,
      '      timeout: 60000,',
      '    },',
    ]
    : [
      "    headless: true,",
      "    trace: 'on',",
      "    screenshot: 'only-on-failure',",
      "    video: 'off',",
      '    actionTimeout: 15000,',
      '    navigationTimeout: 30000,',
    ];
  return [
    "import { defineConfig } from '@playwright/test';",
    '',
    'export default defineConfig({',
    `  outputDir: '${escapeJsString(options.outputDir)}',`,
    '  fullyParallel: false,',
    '  retries: 0,',
    '  workers: 1,',
    '  reporter: [[\'json\', { outputFile: \'report.json\' }]],',
    '  projects: [',
    `    { name: '${engine}', use: { browserName: '${engine}' } },`,
    '  ],',
    '  use: {',
    ...useBlock,
    '  },',
    '});',
    '',
  ].join('\n');
}

export function suggestedFilename(scenario: Pick<GeneratorScenario, 'title' | 'id'>): string {
  const slug = scenario.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || scenario.id.slice(0, 8);
  return slug + '.spec.ts';
}

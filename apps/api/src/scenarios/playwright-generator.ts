// Convierte un TestScenario en un spec de @playwright/test en TypeScript.
// Mecanico, sin IA: reconoce un vocabulario pequeno de prefijos en el campo
// "action" y emite la llamada Playwright correspondiente. Lo que no case se
// traduce a un `// TODO:` con el texto original para que el autor lo
// complete antes de correr la prueba.
//
// Seguridad: todo string interpolado se escapa como literal JS para evitar
// inyeccion de codigo. Nunca pegamos texto crudo del usuario en el spec.

import { createHash } from 'node:crypto';
import { COMPATIBILITY_SCENARIO_TAGS } from './scenario-tags';
import { FRAME_DIAGNOSTICS_SOURCE } from './frame-diagnostics-source';
import {
  generateUploadFixtureHelper, isUploadFixtureKind, parseUploadFixtureData,
  type UploadFixtureKind, UPLOAD_FIXTURE_KINDS,
} from './upload-fixtures';

export type GeneratorStep = {
  ordinal: number;
  action: string;
  data?: string | null;
  expected?: string | null;
  frames?: string[];
  // Acciones DSL alternativas (mismo verbo, pista distinta) que el runtime
  // debe probar si el selector principal no encuentra el elemento. Permite
  // sobrevivir a cambios cosméticos (id generado) sin reescribir el caso.
  // Se emite como locator.or() de Playwright; limitado a 2 alternativas.
  fallbacks?: string[];
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

const ASSERTION_VERBS = new Set([
  'expect-text', 'expect text', 'expect-url', 'expect url',
  'expect-visible', 'expect-hidden', 'expect-checked', 'expect-http-ok',
]);

export function hasPlaywrightAssertion(steps: ReadonlyArray<Pick<GeneratorStep, 'action'>>): boolean {
  return steps.some(step => {
    const parsed = splitAction(step.action);
    return parsed !== null && ASSERTION_VERBS.has(parsed.verb);
  });
}

function commentLines(text: string, indent: string): string[] {
  return text.split(/[\r\n\u2028\u2029]+/).map(line => indent + '// ' + line);
}

export const FRAME_LOCATOR_OPERATIONS: readonly string[] = [
  'click', 'click-text', 'fill', 'fill-label', 'check', 'uncheck', 'expect-text', 'expect-visible', 'expect-checked',
  'hover', 'hover-text', 'scroll-into-view', 'select', 'select-label', 'drag-to',
  'upload',
];

export function readFramePath(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 3) return null;
  return raw.every(selector => typeof selector === 'string'
    && /^iframe\[(?:id|name|data-testid)="[A-Za-z0-9_-]{1,80}"\]$/.test(selector)) ? raw : null;
}

// Verbos cuyo fallback hace sentido: los que resuelven a un Locator. Para
// navigate/press/expect-url no hay dónde aplicar .or(), así que cualquier
// fallback que venga con esos verbos se descarta silenciosamente.
const FALLBACKABLE_VERBS = new Set([
  'click', 'click-text', 'fill', 'fill-label', 'check', 'uncheck',
  'expect-text', 'expect-visible', 'expect-hidden', 'expect-checked',
  'hover', 'hover-text', 'scroll-into-view', 'select', 'select-label',
  // drag-to NO entra: su "fallback" cambiaría dos selectores (origen y
  // destino) y la semántica del or() no aplica. Si el principal falla, lo
  // honesto es que el test falle.
]);

// Un fallback válido es una acción DSL con el MISMO verbo que la principal
// (no mezclar click con fill, por ejemplo) y que apunte a un locator. Se
// limita a 2 alternativas para no inflar el spec.
function readFallbacks(raw: unknown, primaryVerb: string): string[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  if (!FALLBACKABLE_VERBS.has(primaryVerb)) return undefined;
  const valid: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const parsed = splitAction(candidate);
    if (!parsed || !fallbackCompatible(primaryVerb, parsed.verb)) continue;
    valid.push(candidate.trim());
    if (valid.length >= 2) break;
  }
  return valid.length ? valid : undefined;
}

export function readGeneratorSteps(raw: unknown): GeneratorStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object' && typeof step.action === 'string' && !!step.action.trim())
    .map((step, index) => {
      const frames = readFramePath(step.frames);
      const primary = splitAction(step.action as string);
      const fallbacks = primary ? readFallbacks(step.fallbacks, primary.verb) : undefined;
      return {
        ordinal: typeof step.ordinal === 'number' && Number.isSafeInteger(step.ordinal) ? step.ordinal : index + 1,
        action: step.action as string,
        data: typeof step.data === 'string' ? step.data : undefined,
        expected: typeof step.expected === 'string' ? step.expected : undefined,
        ...(frames && { frames }),
        ...(fallbacks && { fallbacks }),
      };
    });
}

export function readAutomationSteps(raw: unknown): GeneratorStep[] {
  return readGeneratorSteps(raw).map(step => {
    if (typeof step.data === 'string') return step;
    const match = step.action.match(/^\s*(fill|fill-label):\s*(.+?)\s+\|\s+(.*)$/i);
    if (!match || !match[2].trim()) return step;
    return { ...step, action: match[1].toLowerCase() + ': ' + match[2].trim(), data: match[3].trim() };
  });
}

const SHARED_STEPS_MODULE = 'autoqa-steps';
export const SHARED_STEPS_FILENAME = SHARED_STEPS_MODULE + '.ts';
const SHARED_STEPS_IMPORT = `import * as steps from './${SHARED_STEPS_MODULE}';`;

export const PLAYWRIGHT_OPERATIONS = [
  'navigate', 'click', 'click-text', 'fill', 'fill-label', 'press', 'check', 'uncheck',
  'expect-text', 'expect-url', 'expect-visible', 'expect-hidden', 'expect-checked', 'expect-http-ok',
  'hover', 'hover-text', 'scroll-into-view', 'select', 'select-label', 'drag-to',
  'upload',
] as const;

const SHARED_VERBS: ReadonlySet<string> = new Set(PLAYWRIGHT_OPERATIONS);

function sharedAction(step: GeneratorStep) {
  const parsed = splitAction(step.action);
  if (!parsed || !SHARED_VERBS.has(parsed.verb)) return null;
  // upload se emite siempre inline: la validación compile-time del fixture
  // vive en renderAction y sin el valor literal del data no podemos hacerla
  // al generar la función shared. Un upload es un paso puntual, no se
  // repite bulk, así que no perdemos reuso real.
  if (parsed.verb === 'upload') return null;
  const { verb, rest } = parsed;
  const frames = step.frames;
  // fallbacks forman parte de la identidad del shared step: dos pasos con el
  // mismo verbo+rest pero distintos fallbacks deben generar funciones distintas.
  const fallbacks = step.fallbacks;
  const key = createHash('sha256').update(JSON.stringify([verb, rest, frames ?? null, fallbacks ?? null])).digest('hex').slice(0, 16);
  return { verb, rest, frames, fallbacks, name: 'step_' + verb.replace(/-/g, '_') + '_' + key };
}

function requiresData(verb: string) {
  // Estos verbos llevan un segundo argumento en step.data:
  //   fill/fill-label      → valor a escribir
  //   select/select-label  → valor de la opción (<option value="...">)
  //   drag-to              → selector CSS del destino
  //   upload               → "fixture:<kind>" de la whitelist (ver upload-fixtures.ts)
  return verb === 'fill' || verb === 'fill-label'
    || verb === 'select' || verb === 'select-label'
    || verb === 'drag-to' || verb === 'upload';
}

export function generateSharedSteps(steps: readonly GeneratorStep[]): string {
  const actions = new Map<string, NonNullable<ReturnType<typeof sharedAction>>>();
  for (const step of steps) {
    const action = sharedAction(step);
    if (action) actions.set(action.name, action);
  }
  const lines = ["import { expect, type Page } from '@playwright/test';", ''];
  for (const { name, verb, rest, frames, fallbacks } of [...actions.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const hasData = requiresData(verb);
    lines.push('export async function ' + name + '(page: Page' + (hasData ? ', data: string' : '') + ') {');
    lines.push(...renderAction(verb, rest, '  ', 'data', frames, fallbacks));
    lines.push('}', '');
  }
  return lines.join('\n');
}

export function generateStepLines(step: GeneratorStep, indent: string, shared = false): string[] {
  const lines: string[] = [];
  lines.push(`${indent}// Paso ${step.ordinal}: ${step.action.split(/[\r\n\u2028\u2029]/)[0]}`);
  if (step.expected && step.expected.trim()) {
    lines.push(...commentLines('Esperado: ' + step.expected.trim(), indent));
  }

  const parsed = splitAction(step.action);
  if (!parsed) {
    lines.push(...commentLines('TODO: ' + step.action, indent));
    return lines;
  }

  const { verb, rest } = parsed;
  // Snapshot por paso: se escribe al final para que el worker arme el carrusel.
  // El nombre lleva el ordinal (orden) y un slug del verbo (para la etiqueta).
  // .catch(() => {}) evita que un screenshot fallido (p.ej. p\u00e1gina en about:blank)
  // tire el test; la assert del paso ya decide pass/fail.
  const screenshotAfter = `${indent}await page.screenshot({ path: 'screenshots/step-${step.ordinal}-${verb.replace(/[^a-z0-9]+/gi, '_')}.png', fullPage: false }).catch(() => {});`;
  const implementation = shared ? sharedAction(step) : null;
  const data = "'" + escapeJsString(step.data ?? '') + "'";
  if (implementation) {
    const argument = requiresData(verb) ? ', ' + data : '';
    lines.push(indent + 'await steps.' + implementation.name + '(page' + argument + ');');
  } else {
    const action = renderAction(verb, rest, indent, data, step.frames, step.fallbacks);
    if (action.length) lines.push(...action);
    else lines.push(...commentLines('TODO (verbo "' + verb + '" no reconocido): ' + step.action, indent));
  }
  lines.push(screenshotAfter);
  return lines;
}

// Devuelve la expresión Playwright que resuelve al elemento para un verbo+rest.
// click, fill, check, expect-visible, etc. acuden a .locator(); click-text
// usa getByText exacto (para clickear el botón concreto); expect-text usa
// getByText inclusivo (el texto puede ser una sub-cadena de un párrafo);
// fill-label usa getByLabel. Separar esta pieza permite componer varias con
// .or() para el fallback de selectores.
function buildLocatorExpression(verb: string, rest: string, scope: string): string | null {
  switch (verb) {
    case 'click':
    case 'fill':
    case 'check':
    case 'uncheck':
    case 'expect-visible':
    case 'expect-hidden':
    case 'expect-checked':
    case 'hover':
    case 'scroll-into-view':
    case 'select':
    case 'drag-to':
    case 'upload':
      return scope + ".locator('" + escapeJsString(rest) + "')";
    case 'click-text':
    case 'hover-text':
      return scope + ".getByText('" + escapeJsString(rest) + "', { exact: true })";
    case 'expect-text':
    case 'expect text':
      return scope + ".getByText('" + escapeJsString(rest) + "')";
    case 'fill-label':
    case 'select-label':
      return scope + ".getByLabel('" + escapeJsString(rest) + "', { exact: true })";
    default:
      return null;
  }
}

// Grupos de verbos "intercambiables" para fallback: click↔click-text ambos
// resuelven a un botón, fill↔fill-label ambos escriben en un campo. El resto
// requiere identidad exacta para evitar mezclar semánticas distintas (un
// expect-visible no puede caer en un check, por ejemplo).
const FALLBACK_VERB_GROUPS: Record<string, ReadonlySet<string>> = {
  'click': new Set(['click', 'click-text']),
  'click-text': new Set(['click', 'click-text']),
  'fill': new Set(['fill', 'fill-label']),
  'fill-label': new Set(['fill', 'fill-label']),
  'hover': new Set(['hover', 'hover-text']),
  'hover-text': new Set(['hover', 'hover-text']),
  'select': new Set(['select', 'select-label']),
  'select-label': new Set(['select', 'select-label']),
};

function fallbackCompatible(primaryVerb: string, candidateVerb: string): boolean {
  const group = FALLBACK_VERB_GROUPS[primaryVerb];
  return group ? group.has(candidateVerb) : primaryVerb === candidateVerb;
}

// Combina el locator principal con sus fallbacks usando Locator.or() de
// Playwright. Cada fallback se parsea como su propia acción DSL; si no
// produce un locator (verbo distinto o no reconocido), se descarta.
function combinedLocator(verb: string, rest: string, scope: string, fallbacks: string[] | undefined): string | null {
  const primary = buildLocatorExpression(verb, rest, scope);
  if (!primary || !fallbacks?.length) return primary;
  const extras: string[] = [];
  for (const raw of fallbacks) {
    const parsed = splitAction(raw);
    if (!parsed || !fallbackCompatible(verb, parsed.verb)) continue;
    const candidate = buildLocatorExpression(parsed.verb, parsed.rest, scope);
    if (candidate) extras.push(candidate);
  }
  return extras.reduce((expr, next) => expr + '.or(' + next + ')', primary);
}

function renderAction(verb: string, rest: string, indent: string, data: string, frames?: string[], fallbacks?: string[]): string[] {
  const lines: string[] = [];
  const scope = frames?.reduce((parent, selector) => parent + ".frameLocator('" + escapeJsString(selector) + "')", 'page') ?? 'page';
  const target = combinedLocator(verb, rest, scope, fallbacks);
  switch (verb) {
    case 'navigate':
    case 'goto':
    case 'open':
      lines.push(`${indent}await page.goto('${escapeJsString(rest)}');`);
      break;
    case 'click':
    case 'click-text':
      lines.push(`${indent}await ${target}.click();`);
      break;
    case 'fill':
    case 'fill-label':
      lines.push(`${indent}await ${target}.fill(${data});`);
      break;
    case 'check':
    case 'uncheck':
      lines.push(`${indent}await ${target}.${verb}();`);
      break;
    case 'expect-visible':
    case 'expect-hidden':
      lines.push(`${indent}await expect(${target}).${verb === 'expect-visible' ? 'toBeVisible' : 'toBeHidden'}();`);
      break;
    case 'expect-checked':
      lines.push(`${indent}await expect(${target}).toBeChecked();`);
      break;
    case 'press':
    case 'key':
      lines.push(`${indent}await page.keyboard.press('${escapeJsString(rest)}');`);
      break;
    case 'expect-text':
    case 'expect text':
      lines.push(`${indent}await expect(${target}).toBeVisible();`);
      break;
    case 'expect-http-ok':
      lines.push(`${indent}expect((await page.goto('${escapeJsString(rest)}'))?.ok()).toBe(true);`);
      break;
    case 'expect-url':
    case 'expect url':
      lines.push(`${indent}await expect(page).toHaveURL('${escapeJsString(rest)}');`);
      break;
    case 'hover':
    case 'hover-text':
      lines.push(`${indent}await ${target}.hover();`);
      break;
    case 'scroll-into-view':
      lines.push(`${indent}await ${target}.scrollIntoViewIfNeeded();`);
      break;
    case 'select':
    case 'select-label':
      // selectOption acepta string (el value del <option>) directamente.
      lines.push(`${indent}await ${target}.selectOption(${data});`);
      break;
    case 'drag-to':
      // Para drag-to el "data" es el selector CSS del destino. Se evalúa
      // como string JS escapado y se pasa a page.locator() dentro de dragTo().
      lines.push(`${indent}await ${target}.dragTo(${scope}.locator(${data}));`);
      break;
    case 'upload': {
      // Seguridad clave: NO interpolamos step.data crudo, lo parseamos como
      // "fixture:<kind>" contra la whitelist. Si no matchea, dejamos un
      // comentario TODO y no emitimos nada ejecutable — nunca un path.
      // El fixture mismo se materializa como Buffer inline en runtime
      // (ver upload-fixtures.ts), así que el agente no ve ni toca el FS.
      const kind = parseUploadFixtureData(stripDataQuotes(data));
      if (kind) {
        lines.push(`${indent}await ${target}.setInputFiles(autoqaFixture('${kind}'));`);
      } else {
        lines.push(...commentLines(
          'TODO: upload requiere data "fixture:<kind>" con kind en ' + UPLOAD_FIXTURE_KINDS.join('|'),
          indent,
        ));
      }
      break;
    }
  }
  return lines;
}

// `data` entra como "'<string escapado>'" (con comillas). Para validar su
// forma lógica necesitamos el string crudo sin comillas ni backslashes JS.
function stripDataQuotes(data: string): string {
  if (data.length < 2 || data[0] !== "'" || data[data.length - 1] !== "'") return data;
  return data.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

// Recorre los pasos y devuelve el conjunto de fixture kinds usadas en verbs
// upload cuyo data parsea. Sirve para emitir el helper autoqaFixture una
// sola vez por spec, con solo los cases necesarios.
function collectUploadKinds(steps: readonly GeneratorStep[]): Set<UploadFixtureKind> {
  const kinds = new Set<UploadFixtureKind>();
  for (const step of steps) {
    const parsed = splitAction(step.action);
    if (!parsed || parsed.verb !== 'upload') continue;
    const kind = parseUploadFixtureData(step.data);
    if (kind) kinds.add(kind);
  }
  return kinds;
}

export function generateSpec(scenario: GeneratorScenario, shared = false): string {
  const title = escapeJsString(scenario.title);
  const lines: string[] = [];
  lines.push(shared ? "import { test } from '@playwright/test';" : "import { expect, test } from '@playwright/test';");
  if (shared) lines.push(SHARED_STEPS_IMPORT);
  lines.push('');
  lines.push(`// Escenario AutoQA ${scenario.id}`);
  if (scenario.expectedResult && scenario.expectedResult.trim()) {
    lines.push(...commentLines('Resultado esperado: ' + scenario.expectedResult.trim(), ''));
  }
  lines.push('');
  const uploadHelper = generateUploadFixtureHelper(collectUploadKinds(scenario.steps));
  if (uploadHelper) lines.push(uploadHelper);
  lines.push(`test('${title}', async ({ page }) => {`);
  if (scenario.steps.length === 0) {
    lines.push('  // TODO: define los pasos del escenario en AutoQA.');
  } else {
    for (const step of scenario.steps) {
      lines.push(...generateStepLines(step, '  ', shared));
      lines.push('');
    }
    if (!shared && scenario.expectedResult && scenario.expectedResult.trim()) {
      lines.push('  // Validacion final sugerida (completar si aplica):');
      lines.push(`  // await expect(page.getByText('${escapeJsString(scenario.expectedResult.trim())}')).toBeVisible();`);
    }
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

type HarnessPath = string | { host: string; path: string };

function harnessPathLiteral(rule: HarnessPath): string {
  return typeof rule === 'string' ? `'${escapeJsString(rule)}'`
    : `{ host: '${escapeJsString(rule.host)}', path: '${escapeJsString(rule.path)}' }`;
}

export type HarnessEnvironment = {
  baseUrl: string | null;
  allowedHosts: string[];
  allowedPaths: HarnessPath[];
  excludedPaths: HarnessPath[];
  allowWrites?: boolean;
};

export type HarnessTarget = {
  // CHROMIUM | FIREFOX | WEBKIT. Null = CHROMIUM por compatibilidad.
  browser?: string | null;
  // Nombre de un preset de Playwright: 'iPhone 13', 'Pixel 7', etc. Null = desktop.
  device?: string | null;
  sharedSteps?: boolean;
  // Ruta ABSOLUTA en el worker a un archivo JSON con el storageState exportado.
  // Si viene, el spec lo consume vía test.use({ storageState }). El worker lo
  // materializa dentro del workdir temporal y lo borra junto con el workdir.
  storageStatePath?: string | null;
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
export type PlaywrightBrowser = typeof SUPPORTED_BROWSERS[number];

export function defaultScenarioBrowser(scenario: { title: string; tags?: readonly string[] | null }): PlaywrightBrowser {
  const title = scenario.title.toUpperCase();
  const fromTitle = SUPPORTED_BROWSERS.find(browser => title.startsWith(`[COMPAT:${browser}]`));
  if (fromTitle) return fromTitle;

  const tags = (scenario.tags ?? []).map(tag => tag.toLowerCase());
  if (COMPATIBILITY_SCENARIO_TAGS.some(tag => tags.includes(tag))) {
    const matches = SUPPORTED_BROWSERS.filter(browser => tags.includes('@' + browser.toLowerCase()));
    if (matches.length === 1) return matches[0];
  }
  return 'CHROMIUM';
}

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
  const allowed = env.allowedPaths.map(harnessPathLiteral).join(', ');
  const excluded = env.excludedPaths.map(harnessPathLiteral).join(', ');
  const device = isSupportedDevice(target.device) ? (target.device ?? null) : null;

  const lines: string[] = [];
  const members = [device && 'devices', !target.sharedSteps && 'expect', 'test'].filter(Boolean);
  lines.push("import { " + members.join(', ') + " } from '@playwright/test';");
  if (target.sharedSteps) {
    lines.push(SHARED_STEPS_IMPORT, "import { writeFile } from 'node:fs/promises';",
      "import type { Frame, Page } from '@playwright/test';");
  }
  lines.push('');
  // Si hay storageState importado por el QA, lo inyectamos en el test.use().
  // Playwright carga cookies+localStorage antes del primer navigate y así el
  // escenario arranca ya autenticado, sin pasos de login. El worker se
  // encargó de validar la ruta y de borrar el archivo con el workdir.
  const storageClause = target.storageStatePath
    ? `, storageState: '${escapeJsString(target.storageStatePath)}'`
    : '';
  if (device) {
    lines.push(`test.use({ ...devices['${escapeJsString(device)}'], baseURL: '${baseURL}'${storageClause} });`);
  } else {
    lines.push(`test.use({ baseURL: '${baseURL}'${storageClause} });`);
  }
  lines.push('');
  lines.push('// Filtro de requests según el alcance y el modo autorizado del entorno.');
  lines.push('// Bloquea hosts fuera del allowlist, paths excluidos y esquemas no HTTP(S).');
  lines.push(`const ALLOWED_HOSTS = new Set<string>([${hosts}]);`);
  lines.push('type ScopePath = string | { host: string; path: string };');
  lines.push(`const ALLOWED_PATHS: ScopePath[] = [${allowed}];`);
  lines.push(`const EXCLUDED_PATHS: ScopePath[] = [${excluded}];`);
  lines.push(`const ALLOW_WRITES = ${env.allowWrites === true};`);
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
  lines.push('function pathMatches(target: URL, rule: ScopePath): boolean {');
  lines.push('  if (typeof rule !== "string" && rule.host !== target.hostname) return false;');
  lines.push('  const path = typeof rule === "string" ? rule : rule.path;');
  lines.push('  return target.pathname === path || target.pathname.startsWith(path.endsWith("/") ? path : path + "/");');
  lines.push('}');
  lines.push('');
  lines.push('function scopeAllowed(target: URL): boolean {');
  lines.push("  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.port) return false;");
  lines.push("  if (target.hostname.startsWith('[') || /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(target.hostname)) return false;");
  lines.push('  if (!hostAllowed(target.hostname) || EXCLUDED_PATHS.some(rule => pathMatches(target, rule))) return false;');
  lines.push('  return ALLOWED_PATHS.length === 0 || ALLOWED_PATHS.some(rule => pathMatches(target, rule));');
  lines.push('}');
  lines.push('');
  lines.push('test.beforeEach(async ({ context }) => {');
  lines.push("  await context.route('**/*', async route => {");
  lines.push('    const request = route.request();');
  lines.push('    const method = request.method().toUpperCase();');
  lines.push("    const readRequest = ['GET', 'HEAD', 'OPTIONS'].includes(method);");
  lines.push('    try {');
  lines.push('      const target = new URL(request.url());');
  lines.push("      if (!scopeAllowed(target) || (!readRequest && !ALLOW_WRITES)) { await route.abort('blockedbyclient'); return; }");
  lines.push('      if (readRequest) { await route.continue(); return; }');
  lines.push('      const response = await route.fetch({ maxRedirects: 0 });');
  lines.push('      const status = response.status();');
  lines.push("      const location = response.headers()['location'];");
  lines.push('      if (location && [301, 302, 303, 307, 308].includes(status)) {');
  lines.push("        const switchesToGet = status === 303 || (method === 'POST' && [301, 302].includes(status));");
  lines.push("        if (!switchesToGet || !scopeAllowed(new URL(location, target))) { await route.abort('blockedbyclient'); return; }");
  lines.push('      }');
  lines.push('      await route.fulfill({ response });');
  lines.push("    } catch { await route.abort('blockedbyclient'); }");
  lines.push('  });');
  lines.push('});');
  lines.push('');
  if (target.sharedSteps) lines.push(FRAME_DIAGNOSTICS_SOURCE);
  const uploadHelper = generateUploadFixtureHelper(collectUploadKinds(scenario.steps));
  if (uploadHelper) lines.push(uploadHelper);
  lines.push(`test('${title}', async ({ page }) => {`);
  if (target.sharedSteps) lines.push('  locatorStep = undefined;');
  if (scenario.steps.length === 0) {
    lines.push('  // Escenario sin pasos: nada que ejecutar.');
  } else {
    for (const step of scenario.steps) {
      if (target.sharedSteps) {
        const action = splitAction(step.action);
        const locator = action && !step.frames && FRAME_LOCATOR_OPERATIONS.includes(action.verb)
          ? JSON.stringify({ step: step.ordinal, kind: action.verb, target: action.rest }) : 'undefined';
        lines.push('  locatorStep = ' + locator + ';');
      }
      lines.push(...generateStepLines(step, '  ', target.sharedSteps));
      if (target.sharedSteps) lines.push('  locatorStep = undefined;');
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
  // screenshot:'on' captura un auto-screenshot al final del test, pero NO uno
  // por paso: eso lo hacemos nosotros con page.screenshot() después de cada
  // acción en generateHarnessedSpec. video:'retain-on-failure' solo guarda el
  // .webm cuando el test falla (los PASS ya quedan cubiertos por el carrusel).
  const useBlock = options.wsEndpoint
    ? [
      "    headless: true,",
      "    trace: 'on',",
      "    screenshot: 'on',",
      "    video: 'retain-on-failure',",
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
      "    screenshot: 'on',",
      "    video: 'retain-on-failure',",
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
    "    serviceWorkers: 'block',",
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

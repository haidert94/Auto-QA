// Pruebas puras del generador: no tocan BD, no requieren AUTOQA_TEST_DATABASE_URL.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const { escapeJsString, generateHarnessedSpec, generatePlaywrightConfig, generateSharedSteps, generateSpec, generateStepLines, readGeneratorSteps, suggestedFilename } = require('../dist/scenarios/playwright-generator');

test('escapeJsString escapa comillas, backslashes y newlines', () => {
  assert.equal(escapeJsString("O'Reilly"), "O\\'Reilly");
  assert.equal(escapeJsString("C:\\path"), "C:\\\\path");
  assert.equal(escapeJsString("line1\nline2"), "line1\\nline2");
  assert.equal(escapeJsString("x\ty"), "x\\ty");
});

test('escapeJsString previene inyección de template literal y separadores Unicode', () => {
  assert.equal(escapeJsString('${danger}'), '${danger}');
  // El $ pelado no necesita escape dentro de comillas simples,
  // pero los separadores Unicode sí (U+2028, U+2029).
  assert.equal(escapeJsString('a\u2028b'), 'a\\u2028b');
  assert.equal(escapeJsString('a\u2029b'), 'a\\u2029b');
});

test('generateStepLines navigate emite page.goto', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'navigate: https://example.com/login' }, '  ');
  assert.ok(lines.some(l => l.includes("await page.goto('https://example.com/login');")));
});

test('generateStepLines click emite page.locator().click', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'click: button.primary' }, '  ');
  assert.ok(lines.some(l => l.includes("await page.locator('button.primary').click();")));
});

test('generateStepLines fill usa el campo data', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'fill: #email', data: 'user@test.com' }, '  ');
  assert.ok(lines.some(l => l.includes("await page.locator('#email').fill('user@test.com');")));
});

test('generateStepLines expect-text emite expect().toBeVisible', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'expect-text: Bienvenido' }, '  ');
  assert.ok(lines.some(l => l.includes("await expect(page.getByText('Bienvenido')).toBeVisible();")));
});

test('generateStepLines expect-url emite toHaveURL', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'expect-url: /dashboard' }, '  ');
  assert.ok(lines.some(l => l.includes("await expect(page).toHaveURL('/dashboard');")));
});

test('generateStepLines sin prefijo reconocido emite TODO', () => {
  const lines = generateStepLines({ ordinal: 2, action: 'Haz magia' }, '  ');
  assert.ok(lines.some(l => l.includes('// TODO: Haz magia')));
});

test('generateStepLines con verbo desconocido lo señala', () => {
  const lines = generateStepLines({ ordinal: 2, action: 'hover: a.menu' }, '  ');
  assert.ok(lines.some(l => l.includes('verbo "hover" no reconocido')));
});

test('generateStepLines incluye el comentario Esperado cuando existe', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'click: .ok', expected: 'El modal se cierra' }, '  ');
  assert.ok(lines.some(l => l.includes('// Esperado: El modal se cierra')));
});

test('generateSpec produce un spec completo con import, test y pasos', () => {
  const spec = generateSpec({
    id: 'abcd1234-ab12-cd34-ef56-7890abcdef12',
    title: 'Login válido',
    expectedResult: 'Usuario entra al dashboard',
    steps: [
      { ordinal: 1, action: 'navigate: https://app/login' },
      { ordinal: 2, action: 'fill: #email', data: 'user@test.com' },
      { ordinal: 3, action: 'click: button[type=submit]' },
      { ordinal: 4, action: 'expect-url: /dashboard' },
    ],
  });
  assert.ok(spec.includes("import { expect, test } from '@playwright/test';"));
  assert.ok(spec.includes("test('Login válido', async ({ page }) => {"));
  assert.ok(spec.includes("await page.goto('https://app/login');"));
  assert.ok(spec.includes("await page.locator('#email').fill('user@test.com');"));
  assert.ok(spec.includes("await page.locator('button[type=submit]').click();"));
  assert.ok(spec.includes("await expect(page).toHaveURL('/dashboard');"));
  assert.ok(spec.includes('// Resultado esperado: Usuario entra al dashboard'));
  assert.ok(spec.includes('// Validacion final sugerida'));
});

test('generateSpec escapa el título contra comillas', () => {
  const spec = generateSpec({
    id: '00000000-0000-0000-0000-000000000000',
    title: "O'Reilly checkout",
    steps: [],
  });
  assert.ok(spec.includes("test('O\\'Reilly checkout'"));
});

test('generateSpec sin pasos emite marcador TODO', () => {
  const spec = generateSpec({ id: 'x', title: 'Vacío', steps: [] });
  assert.ok(spec.includes('// TODO: define los pasos del escenario en AutoQA.'));
});

test('generateHarnessedSpec incluye baseURL y filtro de requests', () => {
  const spec = generateHarnessedSpec({
    id: 'abc', title: 'Compra en cuenta demo', steps: [{ ordinal: 1, action: 'navigate: /cart' }],
  }, {
    baseUrl: 'https://staging.example.com',
    allowedHosts: ['staging.example.com', '*.cdn.example.com'],
    allowedPaths: ['/cart'],
    excludedPaths: ['/admin'],
  });
  assert.ok(spec.includes("test.use({ baseURL: 'https://staging.example.com' });"));
  assert.ok(spec.includes("new Set<string>(['staging.example.com', '*.cdn.example.com'])"));
  assert.ok(spec.includes("ALLOWED_PATHS: ScopePath[] = ['/cart']"));
  assert.ok(spec.includes("EXCLUDED_PATHS: ScopePath[] = ['/admin']"));
  assert.ok(spec.includes('test.beforeEach(async ({ context }) => {'));
  assert.ok(spec.includes("await context.route('**/*'"));
  assert.ok(spec.includes("if (!hostAllowed(target.hostname) || EXCLUDED_PATHS"));
  assert.ok(spec.includes("await page.goto('/cart');"));
});

test('generateHarnessedSpec sin hosts/paths produce arrays vacíos válidos', () => {
  const spec = generateHarnessedSpec({
    id: 'x', title: 'vacio', steps: [],
  }, { baseUrl: '', allowedHosts: [], allowedPaths: [], excludedPaths: [] });
  assert.ok(spec.includes("new Set<string>([])"));
  assert.ok(spec.includes("ALLOWED_PATHS: ScopePath[] = []"));
  assert.ok(spec.includes('// Escenario sin pasos: nada que ejecutar.'));
});

async function interceptedRequests(allowWrites) {
  const calls = [];
  const testFunction = Object.assign(() => {}, {
    use() {},
    beforeEach(setup) { this.setup = setup; },
  });
  const spec = generateHarnessedSpec({ id: 'x', title: 'Prueba del arnés', steps: [] }, {
    baseUrl: 'https://qa.example.test',
    allowedHosts: ['qa.example.test', 'assets.example.test'],
    allowedPaths: [
      { host: 'qa.example.test', path: '/orders' },
      { host: 'assets.example.test', path: '/static' },
    ],
    excludedPaths: [{ host: 'qa.example.test', path: '/orders/real' }],
    allowWrites,
  });
  runInNewContext(ts.transpileModule(spec, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: {}, URL, Set, require: () => ({ test: testFunction }),
  });
  let handle;
  await testFunction.setup({ context: { async route(pattern, handler) { handle = handler; } } });
  return async (method, url, status = 200, location) => {
    calls.length = 0;
    await handle({
      request: () => ({ method: () => method, url: () => url }),
      async abort() { calls.push('abort'); },
      async continue() { calls.push('continue'); },
      async fetch({ maxRedirects }) {
        assert.equal(maxRedirects, 0);
        calls.push('fetch');
        return { status: () => status, headers: () => ({ location }) };
      },
      async fulfill() { calls.push('fulfill'); },
    });
    return [...calls];
  };
}

test('el arnés solo permite escritura cuando está autorizada y conserva el alcance', async () => {
  const readOnly = await interceptedRequests(false);
  assert.deepEqual(await readOnly('GET', 'https://qa.example.test/orders'), ['continue']);
  assert.deepEqual(await readOnly('POST', 'https://qa.example.test/orders'), ['abort']);
  const writable = await interceptedRequests(true);
  assert.deepEqual(await writable('POST', 'https://qa.example.test/orders'), ['fetch', 'fulfill']);
  assert.deepEqual(await writable('POST', 'https://qa.example.test/orders/real'), ['abort']);
  assert.deepEqual(await writable('POST', 'https://assets.example.test/orders'), ['abort']);
  assert.deepEqual(await writable('POST', 'https://qa.example.test/orders', 303, '/orders/confirmation'), ['fetch', 'fulfill']);
  assert.deepEqual(await writable('POST', 'https://qa.example.test/orders', 303, 'https://outside.example.test/'), ['fetch', 'abort']);
  assert.deepEqual(await writable('POST', 'https://qa.example.test/orders', 307, '/orders/confirmation'), ['fetch', 'abort']);
});

test('generatePlaywrightConfig escapa el outputDir y emite JSON reporter', () => {
  const config = generatePlaywrightConfig({ outputDir: 'C:\\temp\\run' });
  assert.ok(config.includes("import { defineConfig } from '@playwright/test';"));
  assert.ok(config.includes("outputDir: 'C:\\\\temp\\\\run'"));
  assert.ok(config.includes("['json', { outputFile: 'report.json' }]"));
  assert.ok(config.includes("trace: 'on'"));
  assert.ok(config.includes("name: 'chromium'"));
  assert.ok(config.includes("browserName: 'chromium'"));
});

test('generatePlaywrightConfig con wsEndpoint emite connectOptions', () => {
  const config = generatePlaywrightConfig({
    outputDir: '/tmp/x',
    browser: 'CHROMIUM',
    wsEndpoint: 'wss://cdp.browserstack.com/playwright?caps=XYZ',
  });
  assert.ok(config.includes("connectOptions:"));
  assert.ok(config.includes("wsEndpoint: 'wss://cdp.browserstack.com/playwright?caps=XYZ'"));
});

test('generatePlaywrightConfig sin wsEndpoint omite connectOptions', () => {
  const config = generatePlaywrightConfig({ outputDir: '/tmp/x' });
  assert.ok(!config.includes('connectOptions'));
});

test('buildBrowserstackWsEndpoint mapea browser y device en los caps', () => {
  const { buildBrowserstackWsEndpoint } = require('../dist/scenarios/playwright-generator');
  const endpoint = buildBrowserstackWsEndpoint({
    userName: 'u', accessKey: 'k', browser: 'FIREFOX', device: 'iPhone 15',
  });
  assert.ok(endpoint.startsWith('wss://cdp.browserstack.com/playwright?caps='));
  const caps = JSON.parse(decodeURIComponent(endpoint.split('caps=')[1]));
  assert.equal(caps.browser, 'playwright-firefox');
  assert.equal(caps.deviceName, 'iPhone 15');
  assert.equal(caps['browserstack.username'], 'u');
  assert.equal(caps['browserstack.accessKey'], 'k');
});

test('isSupportedProvider valida LOCAL y BROWSERSTACK', () => {
  const { isSupportedProvider } = require('../dist/scenarios/playwright-generator');
  assert.equal(isSupportedProvider('LOCAL'), true);
  assert.equal(isSupportedProvider('BROWSERSTACK'), true);
  assert.equal(isSupportedProvider('SAUCE'), false);
  assert.equal(isSupportedProvider(null), true);
});

test('generatePlaywrightConfig cambia el motor según browser', () => {
  const firefox = generatePlaywrightConfig({ outputDir: '/tmp/x', browser: 'FIREFOX' });
  assert.ok(firefox.includes("name: 'firefox'"));
  assert.ok(firefox.includes("browserName: 'firefox'"));
  const webkit = generatePlaywrightConfig({ outputDir: '/tmp/x', browser: 'WEBKIT' });
  assert.ok(webkit.includes("name: 'webkit'"));
  assert.ok(webkit.includes("browserName: 'webkit'"));
});

test('generateHarnessedSpec sin device no importa devices', () => {
  const { generateHarnessedSpec } = require('../dist/scenarios/playwright-generator');
  const spec = generateHarnessedSpec({
    id: 'x', title: 't', steps: [{ ordinal: 1, action: 'navigate: /' }],
  }, { baseUrl: 'https://example.com', allowedHosts: ['example.com'], allowedPaths: [], excludedPaths: [] });
  assert.ok(spec.includes("import { expect, test } from '@playwright/test';"));
  assert.ok(!spec.includes('devices'));
  assert.ok(spec.includes("test.use({ baseURL: 'https://example.com' });"));
});

test('generateHarnessedSpec con device importa devices y hace spread', () => {
  const { generateHarnessedSpec } = require('../dist/scenarios/playwright-generator');
  const spec = generateHarnessedSpec({
    id: 'x', title: 't', steps: [{ ordinal: 1, action: 'navigate: /' }],
  }, { baseUrl: 'https://example.com', allowedHosts: ['example.com'], allowedPaths: [], excludedPaths: [] },
  { device: 'iPhone 13' });
  assert.ok(spec.includes("import { devices, expect, test } from '@playwright/test';"));
  assert.ok(spec.includes("test.use({ ...devices['iPhone 13'], baseURL: 'https://example.com' });"));
});

test('generateHarnessedSpec ignora un device no soportado', () => {
  const { generateHarnessedSpec } = require('../dist/scenarios/playwright-generator');
  const spec = generateHarnessedSpec({
    id: 'x', title: 't', steps: [{ ordinal: 1, action: 'navigate: /' }],
  }, { baseUrl: 'https://example.com', allowedHosts: ['example.com'], allowedPaths: [], excludedPaths: [] },
  { device: "' + process.exit(1) + '" });
  assert.ok(!spec.includes('devices'));
  assert.ok(!spec.includes('process.exit'));
});

test('isSupportedBrowser/isSupportedDevice validan nombres', () => {
  const { isSupportedBrowser, isSupportedDevice } = require('../dist/scenarios/playwright-generator');
  assert.equal(isSupportedBrowser('CHROMIUM'), true);
  assert.equal(isSupportedBrowser('FIREFOX'), true);
  assert.equal(isSupportedBrowser('WEBKIT'), true);
  assert.equal(isSupportedBrowser('OPERA'), false);
  assert.equal(isSupportedBrowser(null), true);
  assert.equal(isSupportedDevice('iPhone 13'), true);
  assert.equal(isSupportedDevice('malicious'), false);
  assert.equal(isSupportedDevice(null), true);
});

test('fallback: generateStepLines compone locator principal con .or()', () => {
  const step = {
    ordinal: 1,
    action: 'click: [data-testid="save"]',
    fallbacks: ['click-text: Guardar'],
  };
  const lines = generateStepLines(step, '  ').join('\n');
  assert.match(lines, /page\.locator\('\[data-testid="save"\]'\)\.or\(page\.getByText\('Guardar', \{ exact: true \}\)\)\.click\(\);/);
});

test('fallback: encadena dos alternativas con .or().or()', () => {
  const step = {
    ordinal: 1,
    action: 'fill: #email',
    data: 'qa@test.com',
    fallbacks: ['fill-label: Correo', 'fill: [name="email"]'],
  };
  const lines = generateStepLines(step, '  ').join('\n');
  assert.match(lines, /page\.locator\('#email'\)\.or\(page\.getByLabel\('Correo', \{ exact: true \}\)\)\.or\(page\.locator\('\[name="email"\]'\)\)\.fill\('qa@test\.com'\);/);
});

test('fallback: expect-text acepta alternativa con el mismo verbo', () => {
  const step = {
    ordinal: 1,
    action: 'expect-text: Bienvenido',
    fallbacks: ['expect-text: Hola'],
  };
  const lines = generateStepLines(step, '  ').join('\n');
  assert.match(lines, /expect\(page\.getByText\('Bienvenido'\)\.or\(page\.getByText\('Hola'\)\)\)\.toBeVisible\(\);/);
});

test('fallback: readGeneratorSteps descarta fallbacks con verbo distinto al principal', () => {
  const [step] = readGeneratorSteps([
    { action: 'click: #save', fallbacks: ['fill: #other', 'click-text: Guardar', 'click-text: Aceptar', 'click-text: Confirmar'] },
  ]);
  // El fill se descarta por verbo; se conservan solo las 2 primeras click-text.
  assert.deepEqual(step.fallbacks, ['click-text: Guardar', 'click-text: Aceptar']);
});

test('fallback: readGeneratorSteps omite fallbacks para verbos sin locator (navigate)', () => {
  const [step] = readGeneratorSteps([
    { action: 'navigate: /inicio', fallbacks: ['navigate: /home'] },
  ]);
  assert.equal(step.fallbacks, undefined);
});

test('fallback: shared steps distinguen por fallbacks (hash distinto)', () => {
  const steps = [
    { ordinal: 1, action: 'click: #save' },
    { ordinal: 2, action: 'click: #save', fallbacks: ['click-text: Guardar'] },
  ];
  const shared = generateSharedSteps(steps);
  // Dos funciones distintas (hashes distintos), no una sola función reutilizada.
  const functionNames = [...shared.matchAll(/export async function (step_click_[a-f0-9]+)/g)].map(m => m[1]);
  assert.equal(functionNames.length, 2);
  assert.notEqual(functionNames[0], functionNames[1]);
  // La función con fallback debe contener .or(); la otra no.
  const withFallback = shared.split('export async function').find(chunk => chunk.includes('.or('));
  assert.ok(withFallback, 'una de las funciones debe tener .or()');
  assert.equal(shared.split('.or(').length - 1, 1, 'solo una función debe tener .or()');
});

test('storageState: generateHarnessedSpec inyecta storageState cuando hay path', () => {
  const env = { baseUrl: 'https://app.test', allowedHosts: ['app.test'], allowedPaths: [], excludedPaths: [] };
  const scenario = { id: 'x', title: 'Panel', expectedResult: null, steps: [{ ordinal: 1, action: 'navigate: /' }] };
  const spec = generateHarnessedSpec(scenario, env, { storageStatePath: '/tmp/autoqa-run-abc/storage-state.json' });
  assert.match(spec, /test\.use\(\{ baseURL: 'https:\/\/app\.test', storageState: '\/tmp\/autoqa-run-abc\/storage-state\.json' \}\);/);
});

test('storageState: sin path, el test.use() queda sin storageState', () => {
  const env = { baseUrl: 'https://app.test', allowedHosts: ['app.test'], allowedPaths: [], excludedPaths: [] };
  const scenario = { id: 'x', title: 'Panel', expectedResult: null, steps: [{ ordinal: 1, action: 'navigate: /' }] };
  const spec = generateHarnessedSpec(scenario, env, {});
  assert.doesNotMatch(spec, /storageState:/);
});

test('storageState: escapa el path para evitar inyección en el literal', () => {
  const env = { baseUrl: 'https://app.test', allowedHosts: ['app.test'], allowedPaths: [], excludedPaths: [] };
  const scenario = { id: 'x', title: 'X', expectedResult: null, steps: [{ ordinal: 1, action: 'navigate: /' }] };
  const spec = generateHarnessedSpec(scenario, env, { storageStatePath: "/tmp/x'; evil()//" });
  // El valor se escribe como literal JS escapado; la comilla simple interna
  // queda prefijada con backslash para que el parser no cierre el string.
  assert.match(spec, /storageState: '\/tmp\/x\\'; evil\(\)\/\/'/);
  // Prueba definitiva: que el spec sea JS parseable sin que "evil" quede como
  // identificador suelto. Buscamos la secuencia ';[espacios]evil' SIN el \\'
  // delante (si apareciera, el escape habría fallado).
  assert.equal(/[^\\]'; evil\(\)/.test(spec), false);
});

test('suggestedFilename produce slug seguro', () => {
  assert.equal(suggestedFilename({ id: 'x', title: 'Login válido' }), 'login-valido.spec.ts');
  assert.equal(suggestedFilename({ id: 'x', title: '  Foo!! Bar??  ' }), 'foo-bar.spec.ts');
  assert.equal(suggestedFilename({ id: 'abcd1234', title: '!!!' }), 'abcd1234.spec.ts');
});

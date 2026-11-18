// Browser regression for the project detail UI. The API is a local fixture:
// this suite does not claim to validate persistence, SMTP, AI or test runners.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { resolve, join } = require('node:path');
const { mkdir, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright-core');
const { expect } = require('@playwright/test');

const root = resolve(__dirname, '../../..');
const projectId = '10000000-0000-4000-8000-000000000001';
const session = 'a'.repeat(64);
const account = {
  name: 'Equipo demo', email: 'qa@example.test', organization: { id: 'demo', name: 'AutoQA Demo' },
  subscription: { status: 'ACTIVE', checkoutPrepared: false, plan: { name: 'Pro', capabilities: [{ code: 'BROWSER_TESTS', availability: 'BETA' }] } },
};
const environment = {
  id: '10000000-0000-4000-8000-000000000002', type: 'STAGING', baseUrl: 'https://staging.example.test/checkout',
  accessMode: 'PRIVATE', authorizationConfirmed: true, authorizedAt: '2026-11-17T12:00:00Z',
  allowedHosts: ['staging.example.test'], allowedPaths: [{ host: 'staging.example.test', path: '/checkout' }],
  excludedPaths: [{ host: 'staging.example.test', path: '/checkout/delete' }], prohibitedActions: ['Compras reales'],
  readOnly: true, credentialUser: 'synthetic-private-identity', hasCredentials: true,
};
let project = {
  id: projectId, name: 'Pasarela Checkout Pagos', status: 'READY', revision: 1, ownerLabel: 'Equipo de pagos',
  description: 'Validación de transacciones, contratos API y flujos de checkout en un entorno autorizado.',
  priorityModules: ['Checkout', 'Contratos API'], missingRequirements: [],
  environments: [environment, { ...environment, id: '10000000-0000-4000-8000-000000000003', type: 'QA', baseUrl: 'https://qa.example.test/', authorizationConfirmed: false, hasCredentials: false }],
  roles: [{ name: 'Tester QA', description: 'Validación del checkout sandbox.', secretReference: 'vault:synthetic-private-reference',
    permissions: [{ resource: 'checkout', action: 'read', allowed: true }, { resource: 'payments', action: 'delete', allowed: false }] }],
  executionSettings: { browser: 'CHROMIUM', maxPages: 10 },
};
let documents = ['PROCESSED', 'UPLOADED', 'VALIDATED', 'DECLARED'].map((state, i) => ({
  id: `20000000-0000-4000-8000-00000000000${i}`, filename: ['spec-checkout.yaml', 'requisitos-pagos.pdf', 'flujos-criticos.md', 'contrato-declarado.txt'][i],
  type: i === 0 ? 'API' : 'REQUIREMENTS', state, classificationSource: 'MANUAL', versions: [],
  currentVersion: state === 'DECLARED' ? null : { id: String(i), number: 1, format: ['yaml', 'pdf', 'md'][i], size: 2048, hasText: state !== 'UPLOADED' },
}));
const ipa = { score: 82, status: 'ASSESSED', signals: [
  { criterion: 'Autorización y alcance', weight: 30, points: 30, missing: [], blocking: true },
  { criterion: 'Documentación y requisitos', weight: 40, points: 22, missing: ['Confirmar requisitos ambiguos.'], blocking: false },
  { criterion: 'Roles y credenciales', weight: 30, points: 30, missing: [], blocking: false },
] };
let docsFail = false;
let ipaFail = false;
let saveCount = 0;
let logoutCalled = false;
let scenariosFail = false;
let historyFail = false;
const scenarioA = '31000001-0000-4000-8000-000000000001';
const scenarioB = '31000002-0000-4000-8000-000000000002';
const requirement = { id: '40000000-0000-4000-8000-000000000001', title: 'Checkout sandbox', externalKey: 'RF-01' };
let scenarios = [
  { id: scenarioA, title: 'Pago exitoso con tarjeta tokenizada 3DS', requirementId: requirement.id,
    expectedResult: 'La pasarela sandbox confirma la transacción.', requirement, tags: ['@flujoBasico', '@smoke'], _count: { results: 1 },
    steps: [{ ordinal: 1, action: 'goto: /checkout' }, { ordinal: 2, action: 'click: #confirmar-pago' }, { ordinal: 3, action: 'expect: Confirmación', expected: 'Transacción confirmada' }] },
  { id: scenarioB, title: 'Rechazo por fondos insuficientes con callback asíncrono', requirementId: requirement.id,
    expectedResult: 'Se informa el rechazo sin duplicar la transacción.', requirement, tags: ['@flujoAlterno', '@apiRest'], _count: { results: 1 },
    steps: [{ ordinal: 1, action: 'goto: /checkout/rechazo' }, { ordinal: 2, action: 'expect: Fondos insuficientes' }] },
  { id: '31000003-0000-4000-8000-000000000003', title: 'Timeout en pasarela y reintento pendiente de especificación', requirementId: null,
    expectedResult: null, requirement: null, tags: ['@edgeCases'], _count: { results: 0 }, steps: [] },
];
let scenarioRuns = scenarios.slice(0, 2).map((scenario, i) => ({
  id: `50000000-0000-4000-8000-00000000000${i}`, scenarioId: scenario.id, scenario: { id: scenario.id, title: scenario.title },
  environmentId: environment.id, status: 'COMPLETED', createdAt: `2026-11-17T1${i}:00:00Z`, startedAt: null, completedAt: null, errorCode: null,
  results: [{ id: String(i), status: i ? 'FAILED' : 'PASSED', durationMs: i ? 3200 : 1400, errorMessage: null, evidenceKey: null }],
}));
const queuedRequests = [];

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
const api = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  const send = (data, status = 200) => { response.statusCode = status; response.end(JSON.stringify(data)); };
  if (request.headers.authorization !== `Bearer ${session}`) return send({ message: 'Sesión requerida' }, 401);
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/api/commerce/me') return send(account);
  if (path === '/api/commerce/logout' && request.method === 'POST') { logoutCalled = true; return send({}); }
  const base = `/api/projects/${projectId}`;
  if (path === base + '/scenarios/requirements') return send([requirement]);
  if (path === base + '/scenarios') {
    if (request.method === 'POST') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      const created = { ...payload, id: '31000004-0000-4000-8000-000000000004', tags: [], requirement: null, _count: { results: 0 } };
      scenarios.push(created); return send(created, 201);
    }
    return scenariosFail ? send({ message: 'Consulta de escenarios fallida' }, 503) : send(scenarios);
  }
  const scenarioPath = path.slice((base + '/scenarios/').length);
  if (path.startsWith(base + '/scenarios/')) {
    const scenario = scenarios.find(item => scenarioPath.startsWith(item.id));
    if (scenario && scenarioPath === scenario.id && request.method === 'PATCH') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      Object.assign(scenario, JSON.parse(Buffer.concat(chunks).toString())); return send(scenario);
    }
    if (scenario && scenarioPath === scenario.id + '/runs' && request.method === 'POST') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString()); queuedRequests.push({ scenarioId: scenario.id, ...payload });
      if (scenario.id === scenarioB) return send({ message: 'Cuota de ejecuciones alcanzada.' }, 403);
      const run = { id: '50000000-0000-4000-8000-000000000099', scenarioId: scenario.id, scenario: { id: scenario.id, title: scenario.title },
        status: 'QUEUED', createdAt: '2026-11-18T12:00:00Z', completedAt: null, startedAt: null, errorCode: null, environmentId: payload.environmentId, results: [] };
      scenarioRuns.push(run); return send(run, 201);
    }
  }
  if (path === base + '/runs') return historyFail ? send({ message: 'Historial no disponible' }, 503) : send(scenarioRuns);
  if (path === base && request.method === 'PUT') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    project = { ...project, ...payload, revision: project.revision + 1,
      environments: payload.environments.map((env, i) => ({ ...project.environments[i], ...env })) };
    saveCount++;
    return send(project);
  }
  if (path === base) return send(project);
  if (path === base + '/ipa') return ipaFail ? send({ message: 'IPA no disponible' }, 503) : send({ ipa });
  if (path === base + '/documents') return docsFail ? send({ message: 'Documentos temporalmente no disponibles.' }, 503) : send(documents);
  if (path === base + '/documents/analysis') return send({ analysis: null, ipa: { ...ipa, verifiable: 0, ambiguous: 0,
    documents: { declared: 1, uploaded: 3, processed: 2, validated: 1 }, signals: [], recommendations: [] } });
  if (path.startsWith(base + '/')) return send([]);
  return send({ message: 'No encontrado' }, 404);
});

async function verifyScenarios(page, screenshots) {
  await page.getByRole('tab', { name: /^Escenarios \(3\)$/ }).click();
  const list = page.locator('.scenario-results');
  const detail = page.getByRole('complementary', { name: 'Detalle del escenario seleccionado' });
  await expect(list.locator('.scenario-result')).toHaveCount(3);
  await expect(list.getByText('Pasó · 1.4 s', { exact: true })).toBeVisible();
  await expect(list.getByText('Falló · 3.2 s', { exact: true })).toBeVisible();
  await expect(list.getByText('Sin ejecuciones', { exact: true })).toBeVisible();
  await expect(detail.getByText('Requisito: inventado')).toHaveCount(0);
  assert.equal(queuedRequests.length, 0, 'Abrir escenarios no ejecuta pruebas.');
  await page.setViewportSize({ width: 1170, height: 950 });
  assert.ok((await list.boundingBox()).x < (await detail.boundingBox()).x);
  await page.screenshot({ path: join(screenshots, 'project-scenarios-desktop.png'), fullPage: true, animations: 'disabled' });
  const search = page.getByRole('searchbox', { name: 'Buscar escenarios' });
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await search.fill('fondos insuficientes');
  await expect(list.locator('.scenario-result')).toHaveCount(1);
  await expect(detail.getByRole('heading', { name: scenarios[1].title, exact: true })).toBeVisible();
  await search.fill('');
  const modes = page.getByRole('group', { name: 'Filtrar por resultados' });
  await modes.getByRole('button', { name: 'Con resultados (2)', exact: true }).click();
  await expect(list.locator('.scenario-result')).toHaveCount(2);
  const tags = page.getByRole('group', { name: 'Filtrar por etiqueta' });
  await tags.getByRole('button', { name: '@flujoBasico (1)', exact: true }).click();
  await expect(list.locator('.scenario-result')).toHaveCount(1);
  await tags.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await modes.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Seleccionar visibles (3)', exact: true }).uncheck();
  await search.fill('tokenizada');
  await page.getByRole('checkbox', { name: 'Seleccionar visibles (1)', exact: true }).check();
  await search.fill('');
  const featureDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar feature', exact: true }).click();
  const feature = await featureDownload;
  assert.equal(feature.suggestedFilename(), 'autoqa-escenarios.feature');
  const featureContent = await readFile(await feature.path(), 'utf8');
  assert.ok(featureContent.includes('Vista derivada'));
  assert.ok(featureContent.includes(scenarioA));
  assert.ok(featureContent.includes('goto: /checkout'));
  assert.ok(!featureContent.includes(scenarioB), 'Exporta sólo los escenarios seleccionados.');
  await list.getByRole('button', { name: scenarios[2].title, exact: true }).click();
  await expect(detail.getByText('No declarado. Pendiente de definir.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar detalle del escenario', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await list.getByRole('button', { name: scenarios[0].title, exact: true }).click();
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Escenarios sin desbordamiento a ${width}px.`);
    if (width === 390) {
      const rows = await list.boundingBox(); const sidebar = await detail.boundingBox();
      assert.ok(rows.y + rows.height <= sidebar.y, 'El detalle se apila en móvil.');
      await page.screenshot({ path: join(screenshots, 'project-scenarios-mobile.png'), fullPage: true, animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Nuevo escenario', exact: true }).click();
  const form = page.getByRole('form', { name: 'Nuevo escenario manual' });
  await form.getByLabel('Título', { exact: true }).fill('Escenario creado desde el nuevo diseño');
  await form.getByLabel('Primer paso', { exact: true }).fill('goto: /qa');
  await form.getByRole('button', { name: 'Crear escenario', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Escenarios (4)', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Escenario creado desde el nuevo diseño', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Editar escenario', exact: true }).click();
  await detail.getByLabel('Título', { exact: true }).fill('Pago sandbox editado');
  await detail.getByLabel('@flujoAlterno', { exact: true }).check();
  await detail.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Pago sandbox editado', exact: true })).toBeVisible();
  assert.ok(scenarios[0].tags.includes('@flujoAlterno') && !scenarios[0].tags.includes('@flujoBasico'));
  const execute = page.getByRole('button', { name: 'Ejecutar suite (1)', exact: true });
  await execute.click();
  let dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await expect(dialog.getByLabel('Entorno autorizado').locator('option')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(queuedRequests.length, 0, 'Cancelar la confirmación no encola nada.');
  await execute.click();
  dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ejecución', exact: true }).click();
  await expect(dialog.getByText(/En cola ·/)).toBeVisible();
  assert.deepEqual(queuedRequests, [{ scenarioId: scenarioA, environmentId: environment.id }]);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(list.locator('.scenario-result').filter({ hasText: 'Pago sandbox editado' }).getByText('En cola', { exact: true })).toBeVisible();
  await list.getByRole('checkbox', { name: 'Seleccionar Pago sandbox editado', exact: true }).uncheck();
  await list.getByRole('checkbox', { name: `Seleccionar ${scenarios[1].title}`, exact: true }).check();
  await execute.click();
  dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ejecución', exact: true }).click();
  await expect(dialog.getByText('Cuota de ejecuciones alcanzada.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  scenariosFail = true;
  await page.reload();
  await expect(page.getByText('No se pudo cargar el listado de escenarios.', { exact: true })).toBeVisible();
  scenariosFail = false;
  await page.getByRole('button', { name: 'Reintentar escenarios', exact: true }).click();
  await expect(list.locator('.scenario-result')).toHaveCount(4);
  historyFail = true;
  await page.reload();
  await expect(page.locator('.scenario-history-warning').filter({ hasText: 'No se pudo consultar el historial' })).toBeVisible();
  await expect(list.getByText('Estado no disponible', { exact: true })).toHaveCount(4);
  historyFail = false;
  await page.getByRole('button', { name: 'Reintentar historial', exact: true }).click();
  await expect(list.getByText('En cola', { exact: true })).toBeVisible();
  const populated = scenarios;
  scenarios = [];
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Aún no hay escenarios', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar feature', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ejecutar suite (0)', exact: true })).toBeDisabled();
  scenarios = populated;
  project.status = 'DRAFT';
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Escenarios (4)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ejecutar suite (4)', exact: true })).toBeDisabled();
  project.status = 'READY';
  const authorizations = project.environments.map(environment => environment.authorizationConfirmed);
  project.environments.forEach(environment => { environment.authorizationConfirmed = false; });
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Escenarios (4)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ejecutar suite (4)', exact: true })).toBeDisabled();
  project.environments.forEach((environment, i) => { environment.authorizationConfirmed = authorizations[i]; });
  await page.reload();
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  console.log('PASS escenarios: listado/detalle, búsqueda y etiquetas, selección, exportación derivada, creación/edición, confirmación sin envíos automáticos, encolado y errores de cuota, reintentos, estados vacíos, borradores y autorización; escritorio y móvil.');
}

async function run() {
  const apiPort = await listen(api);
  const reservation = createServer();
  const webPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const website = `http://127.0.0.1:${webPort}`;
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', AUTOQA_LEGACY_MODE: 'false',
    AUTOQA_INTERNAL_API_URL: `http://127.0.0.1:${apiPort}/api`, AUTOQA_ACCOUNT_ORIGIN: website };
  const web = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(webPort)],
    { cwd: join(root, 'apps/web'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  web.stdout.on('data', data => { output += data; });
  web.stderr.on('data', data => { output += data; });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100 && web.exitCode === null; i++) {
      try { await fetch(website + '/login', { signal: AbortSignal.timeout(2000) }); ready = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, 'Next.js debe iniciar. ' + output);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addCookies([{ name: 'autoqa_session', value: session, url: website, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${website}/projects/${projectId}`);
    await page.getByRole('heading', { name: project.name, exact: true }).waitFor();
    await page.getByText('spec-checkout.yaml', { exact: true }).waitFor();
    const header = await page.locator('.app-nav').boundingBox();
    assert.equal(header.x, 0, 'La cabecera ocupa todo el ancho, sin margen lateral heredado.');
    assert.equal(header.y, 0, 'La cabecera empieza en el borde superior.');
    assert.equal(header.width, 1440);
    await page.locator('.app-nav-org').getByText('AutoQA Demo', { exact: true }).waitFor();
    await page.locator('.app-nav-plan').getByText('Pro', { exact: true }).waitFor();
    const userMenu = page.getByLabel('Menú de la cuenta', { exact: true });
    await userMenu.click();
    await page.locator('.app-nav-menu-content').getByText('Equipo demo', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.app-nav-menu').getAttribute('open'), null);
    await userMenu.press('Enter');
    await page.locator('.app-nav-menu-content').getByText('qa@example.test', { exact: true }).waitFor();
    await page.getByRole('heading', { name: project.name, exact: true }).click();
    assert.equal(await page.locator('.app-nav-menu').getAttribute('open'), null, 'Cierra al pulsar fuera.');
    account.organization.name = account.name;
    await page.reload();
    await page.locator('.app-nav-org-name').getByText('Equipo demo', { exact: true }).waitFor();
    account.organization.name = 'AutoQA Demo';
    await page.reload();
    await page.getByText('spec-checkout.yaml', { exact: true }).waitFor();
    assert.deepEqual((await page.locator('.detail-document-state').allTextContents()).sort(), ['Cargado', 'Declarado', 'Procesado', 'Validado']);
    const main = await page.locator('.project-overview__main').boundingBox();
    const aside = await page.locator('.project-overview__aside').boundingBox();
    assert.ok(main.x + main.width <= aside.x, 'Escritorio: IPA a la derecha de los datos.');
    assert.equal(await page.locator('.ipa-score-value').textContent(), '82');
    assert.equal(await page.getByText(/synthetic-private/).count(), 0);
    await page.getByRole('button', { name: 'Copiar URL base' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), environment.baseUrl);
    await page.getByLabel('Entorno seleccionado').selectOption(project.environments[1].id);
    await page.locator('.detail-fields').getByText('Pendiente de confirmación', { exact: true }).waitFor();
    assert.ok((await page.locator('.detail-url').textContent()).includes('https://qa.example.test/'));
    await page.getByLabel('Entorno seleccionado').selectOption(environment.id);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar especificación' }).click();
    const download = await downloadPromise;
    const exportedText = await readFile(await download.path(), 'utf8');
    const exported = JSON.parse(exportedText);
    assert.equal(exported.id, projectId);
    assert.equal(exported.roles[0].permissions[1].allowed, false);
    for (const privateValue of ['secretReference', 'credentialUser', 'synthetic-private', 'hasCredentials']) assert.ok(!exportedText.includes(privateValue));
    const screenshots = process.env.AUTOQA_UI_SCREENSHOT_DIR || join(tmpdir(), 'autoqa-project-detail-preview');
    await mkdir(screenshots, { recursive: true });
    await page.locator('.app-nav').screenshot({ path: join(screenshots, 'app-navigation-desktop.png') });
    await page.setViewportSize({ width: 1155, height: 900 });
    await page.locator('.app-nav').screenshot({ path: join(screenshots, 'app-navigation-reference-width.png') });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: join(screenshots, 'project-detail-desktop.png'), fullPage: true });
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Sin desbordamiento a ${width}px.`);
      if (width === 390) {
        await page.getByRole('button', { name: 'Menú', exact: true }).click();
        await page.getByRole('navigation', { name: 'Navegación principal' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Menú', exact: true }).getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        await page.getByRole('navigation', { name: 'Navegación principal' }).waitFor({ state: 'hidden' });
        await userMenu.click();
        await page.getByRole('button', { name: 'Cerrar sesión' }).waitFor();
        await page.keyboard.press('Escape');
        const mobileMain = await page.locator('.project-overview__main').boundingBox();
        const mobileAside = await page.locator('.project-overview__aside').boundingBox();
        assert.ok(mobileMain.y + mobileMain.height <= mobileAside.y, 'Móvil: IPA después de los datos.');
        await page.screenshot({ path: join(screenshots, 'project-detail-mobile.png'), fullPage: true });
      }
    }
    account.organization.name = 'Organización con un nombre muy largo para comprobar el encabezado en móvil';
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320, 'El nombre largo no desborda en móvil.');
    account.organization.name = 'AutoQA Demo';
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.reload();
    await page.getByRole('tab', { name: 'Datos', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /^Escenarios/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('tab', { name: 'Datos', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('link', { name: 'Automatizar con IA', exact: true }).click();
    await page.getByRole('tab', { name: 'Automatización', exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Automatización', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await page.getByRole('button', { name: 'Adjuntar nuevo documento o especificación' }).click();
    await page.getByRole('heading', { name: 'Documentación y requisitos', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'document-heading');
    await page.getByLabel('Seleccionar archivos').setInputFiles({ name: 'nuevo-requisito.md', mimeType: 'text/markdown', buffer: Buffer.from('# Requisito de prueba') });
    await page.getByText('nuevo-requisito.md', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Quitar archivo', exact: true }).click();
    await page.getByLabel('Propietario declarado').fill('Equipo actualizado');
    await page.getByRole('button', { name: /Completar registro/ }).click();
    await page.locator('.detail-fields').getByText('Equipo actualizado', { exact: true }).waitFor();
    assert.equal(saveCount, 1, 'La edición sigue utilizando el formulario y el proxy existentes.');
    await page.getByRole('button', { name: 'Editar roles y permisos' }).click();
    await page.getByRole('heading', { name: 'Roles de la aplicación', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'role-heading');
    await page.getByRole('button', { name: /Volver a la vista de resumen/ }).click();
    await verifyScenarios(page, screenshots);
    docsFail = true;
    await page.reload();
    await page.getByText('Documentos temporalmente no disponibles.', { exact: true }).waitFor();
    docsFail = false;
    await page.getByRole('button', { name: 'Reintentar consulta' }).click();
    await page.getByText('spec-checkout.yaml', { exact: true }).waitFor();
    documents = [];
    ipaFail = true;
    await page.reload();
    await page.getByText('Aún no hay documentos asociados.', { exact: true }).waitFor();
    await page.getByText(/No se pudo consultar la evaluación/).waitFor();
    assert.equal(await page.locator('.ipa-score-value').count(), 0, 'No inventa una puntuación si falla IPA.');
    account.subscription.plan.capabilities = [];
    await page.reload();
    assert.equal(await page.getByRole('tab', { name: 'Exploración', exact: true }).count(), 0, 'Se conserva la visibilidad por plan.');
    project = { ...project, status: 'DRAFT' };
    await page.reload();
    await page.getByLabel('Nombre de la aplicación').waitFor();
    assert.equal(await page.getByLabel('Nombre de la aplicación').inputValue(), project.name, 'Los borradores conservan el formulario.');
    account.subscription.plan = undefined;
    await page.reload();
    assert.equal(await page.locator('.app-nav-plan').count(), 0, 'No inventa un plan cuando no está asignado.');
    await userMenu.click();
    await page.getByText('Plan: Sin plan asignado', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page.waitForURL(website + '/');
    assert.equal(logoutCalled, true, 'Conserva el endpoint de cierre de sesión.');
    assert.deepEqual(pageErrors, [], 'No hay errores de JavaScript durante las interacciones.');
    console.log('PASS: cabecera de ancho completo, organización/plan real, menú de cuenta/teclado/cierre de sesión, navegación móvil y nombres largos; detalle escritorio/móvil (1440/768/390/320), documentos, entornos, exportación, edición, tabs, errores, IPA ausente, permisos y borradores. API simulada; no valida persistencia ni motores.');
    console.log('Capturas: ' + screenshots);
  } finally {
    await browser?.close();
    web.kill();
    await new Promise(resolve => api.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

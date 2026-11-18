// Browser regression for the project detail UI. The API is a local fixture:
// this suite does not claim to validate persistence, SMTP, AI or test runners.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { resolve, join } = require('node:path');
const { mkdir, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright-core');

const root = resolve(__dirname, '../../..');
const projectId = '10000000-0000-4000-8000-000000000001';
const session = 'a'.repeat(64);
const account = {
  name: 'Equipo demo', email: 'qa@example.test', organization: { id: 'demo', name: 'AutoQA Demo' },
  subscription: { status: 'ACTIVE', checkoutPrepared: false, plan: { capabilities: [{ code: 'BROWSER_TESTS', availability: 'BETA' }] } },
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
  const base = `/api/projects/${projectId}`;
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
    await page.screenshot({ path: join(screenshots, 'project-detail-desktop.png'), fullPage: true });
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Sin desbordamiento a ${width}px.`);
      if (width === 390) {
        const mobileMain = await page.locator('.project-overview__main').boundingBox();
        const mobileAside = await page.locator('.project-overview__aside').boundingBox();
        assert.ok(mobileMain.y + mobileMain.height <= mobileAside.y, 'Móvil: IPA después de los datos.');
        await page.screenshot({ path: join(screenshots, 'project-detail-mobile.png'), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('tab', { name: 'Datos', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'Escenarios', exact: true }).getAttribute('aria-selected'), 'true');
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
    assert.deepEqual(pageErrors, [], 'No hay errores de JavaScript durante las interacciones.');
    console.log('PASS: diseño escritorio/móvil (1440/768/390/320), datos y estados documentales, entornos, copiar URL, exportación sin credenciales, tabs/teclado, formulario de documentos, edición/guardado, roles, error/reintento, IPA ausente, plan y borradores. API simulada; no valida persistencia ni motores.');
    console.log('Capturas: ' + screenshots);
  } finally {
    await browser?.close();
    web.kill();
    await new Promise(resolve => api.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

// Browser regression for the project detail UI. The API is a local fixture:
// this suite does not claim to validate persistence, SMTP, AI or test runners.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { resolve, join } = require('node:path');
const { mkdir, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright-core');
const { expect } = require('@playwright/test');
const JSZip = require('jszip');

const root = resolve(__dirname, '../../..');
const projectId = '10000000-0000-4000-8000-000000000001';
const session = 'a'.repeat(64);
const account = {
  name: 'Equipo demo', email: 'qa@example.test', role: 'OWNER', organization: { id: 'demo', name: 'AutoQA Demo' },
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
let specFailure = false;
let malformedSpec = false;
let reportMode = false;
let reportForbidden = false;
let qualityMode = false;
let qualityIcspFail = false;
let qualityMalformed = false;
let qualityExportFail = false;
let qualityNoResults = false;
let qualityAuditForbidden = false;
let qualityEmptyHistory = false;
let auditPosts = 0;
const qualityIcsp = {
  score: 88, generatedAt: '2026-11-18T12:00:00Z', window: { days: 30, from: '2026-10-19T12:00:00Z', to: '2026-11-18T12:00:00Z' },
  counts: { requirements: 4, scenarios: 5, runs: 12, results: 5, passed: 3, failed: 2 },
  dimensions: [
    { code: 'requirementsCoverage', label: 'Cobertura de requisitos', weight: 30, value: 1, numerator: 4, denominator: 4 },
    { code: 'executionCoverage', label: 'Cobertura de ejecución', weight: 20, value: 1, numerator: 5, denominator: 5 },
    { code: 'stability', label: 'Estabilidad', weight: 30, value: .6, numerator: 3, denominator: 5 },
    { code: 'traceability', label: 'Trazabilidad', weight: 20, value: 1, numerator: 5, denominator: 5 },
  ],
  gaps: { requirementsWithoutScenario: [], scenariosNotExecuted: [], unstableScenarios: [{ id: '31000002-0000-4000-8000-000000000002', label: 'Callback rechazado', detail: 'Tiene resultados distintos en la ventana.' }] },
};
const scenarioA = '31000001-0000-4000-8000-000000000001';
const scenarioB = '31000002-0000-4000-8000-000000000002';
const requirement = { id: '40000000-0000-4000-8000-000000000001', title: 'Checkout sandbox', externalKey: 'RF-01' };
let scenarios = [
  { id: scenarioA, title: 'Pago exitoso con tarjeta tokenizada 3DS', requirementId: requirement.id,
    expectedResult: 'La pasarela sandbox confirma la transacción.', requirement, tags: ['@flujoBasico', '@smoke'], _count: { results: 1 },
    steps: [{ ordinal: 1, action: 'goto: /checkout' }, { ordinal: 2, action: 'click: #confirmar-pago' }, { ordinal: 3, action: 'expect-text: Confirmación', expected: 'Transacción confirmada' }] },
  { id: scenarioB, title: 'Rechazo por fondos insuficientes con callback asíncrono', requirementId: requirement.id,
    expectedResult: 'Se informa el rechazo sin duplicar la transacción.', requirement, tags: ['@flujoAlterno', '@apiRest'], _count: { results: 1 },
    steps: [{ ordinal: 1, action: 'goto: /checkout/rechazo' }, { ordinal: 2, action: 'expect-text: Fondos insuficientes' }] },
  { id: '31000003-0000-4000-8000-000000000003', title: 'Timeout en pasarela y reintento pendiente de especificación', requirementId: null,
    expectedResult: null, requirement: null, tags: ['@edgeCases'], _count: { results: 0 }, steps: [] },
];
let scenarioRuns = scenarios.slice(0, 2).map((scenario, i) => ({
  id: `50000000-0000-4000-8000-00000000000${i}`, scenarioId: scenario.id, scenario: { id: scenario.id, title: scenario.title },
  environmentId: environment.id, status: 'COMPLETED', createdAt: `2026-11-17T1${i}:00:00Z`, startedAt: null, completedAt: null, errorCode: null,
  results: [{ id: String(i), status: i ? 'FAILED' : 'PASSED', durationMs: i ? 3200 : 1400, errorMessage: null, evidenceKey: null }],
}));
const queuedRequests = [];
const reportError = 'Timeout <checkout> & "callback" </failure><evil/>\u0000';
const reportRuns = ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'QUEUED', 'RUNNING', 'NO_RESULT'].map((status, i) => ({
  id: `6100000${i + 1}-0000-4000-8000-000000000001`, scenarioId: i % 2 ? scenarioB : scenarioA,
  scenario: { id: i % 2 ? scenarioB : scenarioA, title: i % 2 ? 'Callback rechazado' : 'Checkout confirmado' },
  environmentId: environment.id, status: status === 'QUEUED' || status === 'RUNNING' ? status : status === 'NO_RESULT' ? 'FAILED' : 'COMPLETED',
  createdAt: `2026-11-18T12:0${i}:00Z`, startedAt: i < 2 ? `2026-11-18T12:0${i}:00Z` : null,
  completedAt: i < 2 ? `2026-11-18T12:0${i}:02Z` : null, errorCode: status === 'NO_RESULT' ? 'ENV_UNAVAILABLE' : null,
  targetBrowser: i === 0 ? 'CHROMIUM' : i === 1 ? 'FIREFOX' : null, targetDevice: null, targetProvider: 'LOCAL',
  results: i < 4 ? [{ id: `6200000${i + 1}-0000-4000-8000-000000000001`, status, durationMs: [1400, 3200, null, 0][i],
    errorMessage: status === 'FAILED' ? reportError : null, evidenceKey: i === 0 ? 'private-internal-key' : null }] : [],
}));

const savedPlaywright = new Map();
const previewRequests = [];
const trackedRunRequests = [];
let trackingFailures = 0;
let activityUnavailable = false;
let stopRequests = 0;
let runAdmission = null;
let runCapacity = Infinity;
const scenarioVersion = scenario => JSON.stringify([scenario.title, scenario.expectedResult, scenario.steps]);

function persistFixtureSpec(scenario) {
  const saved = { automationId: randomUUID(), version: scenarioVersion(scenario) };
  savedPlaywright.set(scenario.id, saved);
  return saved.automationId;
}

function fixtureSpec(scenario) {
  const steps = (scenario.steps ?? []).flatMap(step => {
    const value = step.action.split(':').slice(1).join(':').trim();
    if (step.action.startsWith('goto:')) return [`  await page.goto(${JSON.stringify(value)});`];
    if (step.action.startsWith('click:')) return [`  await page.locator(${JSON.stringify(value)}).click();`];
    if (step.action.startsWith('expect-text:')) return [`  await expect(page.getByText(${JSON.stringify(value)})).toBeVisible();`];
    return ['  // TODO: revisar acción no reconocida'];
  });
  const saved = savedPlaywright.get(scenario.id);
  return { filename: scenario.id === scenarioB ? '../../payment-declined.spec.ts' : `${scenario.id.slice(0, 8)}-checkout.spec.ts`,
    automationId: saved?.version === scenarioVersion(scenario) ? saved.automationId : null,
    code: ["import { expect, test } from '@playwright/test';", '', `// Escenario ${scenario.id}`,
      ...(scenario.id === scenarioB ? ['// <img src=x onerror="window.autoqaInjected=true">'] : []), `test(${JSON.stringify(scenario.title)}, async ({ page }) => {`,
      ...(steps.length ? steps : ['  // TODO: define los pasos del escenario en AutoQA.']), '});', ''].join('\n') };
}

function completeFixtureRun(run) {
  run.status = 'COMPLETED';
  run.results = [{ status: 'PASSED', durationMs: 450 }];
}

async function finishFixtureRun(dialog) {
  completeFixtureRun(scenarioRuns.at(-1));
  await expect(dialog.getByRole('link', { name: 'Ver reporte', exact: true })).toBeVisible({ timeout: 10000 });
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
const api = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  const send = (data, status = 200) => { response.statusCode = status; response.end(JSON.stringify(data)); };
  if (request.headers.authorization !== `Bearer ${session}`) return send({ message: 'Sesión requerida' }, 401);
  const requestUrl = new URL(request.url, 'http://localhost');
  const path = requestUrl.pathname;
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
    return scenariosFail ? send({ message: 'Consulta de escenarios fallida' }, 503) : send(scenarios.map(scenario => {
      const { filename, automationId } = fixtureSpec(scenario);
      return { ...scenario, playwright: automationId ? { filename, automationId } : null };
    }));
  }
  const scenarioPath = path.slice((base + '/scenarios/').length);
  if (path.startsWith(base + '/scenarios/')) {
    const scenario = scenarios.find(item => scenarioPath.startsWith(item.id));
    if (scenario && scenarioPath === scenario.id + '/playwright') {
      if (scenario.id === scenarioB && specFailure) return send({ message: 'Generador temporalmente no disponible.' }, 503);
      if (scenario.id === scenarioB && malformedSpec) return send({ spec: 'contrato incorrecto' });
      if (request.method === 'GET') previewRequests.push(scenario.id);
      const spec = fixtureSpec(scenario);
      if (request.method === 'POST' && !spec.automationId && spec.code.includes('await expect(')) {
        spec.automationId = persistFixtureSpec(scenario);
      }
      return send(spec);
    }
    if (scenario && scenarioPath === scenario.id && request.method === 'PATCH') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      Object.assign(scenario, JSON.parse(Buffer.concat(chunks).toString())); return send(scenario);
    }
    if (scenario && scenarioPath === scenario.id + '/runs' && request.method === 'POST') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString()); queuedRequests.push({ scenarioId: scenario.id, ...payload });
      if (runAdmission) await runAdmission;
      if (scenario.id === scenarioB) return send({ message: 'Cuota de ejecuciones alcanzada.' }, 403);
      if (scenarioRuns.filter(run => ['QUEUED', 'RUNNING'].includes(run.status)).length >= runCapacity) {
        return send({ code: 'RUN_CONCURRENCY_LIMIT', message: 'Alcanzaste el límite de ejecuciones simultáneas.' }, 409);
      }
      const run = { id: randomUUID(), scenarioId: scenario.id, scenario: { id: scenario.id, title: scenario.title },
        status: 'QUEUED', createdAt: '2026-11-18T12:00:00Z', completedAt: null, startedAt: null, errorCode: null, environmentId: payload.environmentId, results: [] };
      scenarioRuns.push(run); return send(run, 201);
    }
  }
  if (path === base + '/runs/activity') {
    if (activityUnavailable) return send({ message: 'Actividad no disponible.' }, 503);
    const activityRuns = reportMode ? reportRuns : scenarioRuns;
    return send({
      running: activityRuns.filter(run => run.status === 'RUNNING' && run.errorCode !== 'cancel-requested').length,
      queued: activityRuns.filter(run => run.status === 'QUEUED').length,
      stopping: activityRuns.filter(run => run.status === 'RUNNING' && run.errorCode === 'cancel-requested').length,
    });
  }
  if (path === base + '/runs/cancel' && request.method === 'POST') {
    stopRequests++;
    let queuedCanceled = 0;
    let runningRequested = 0;
    for (const run of scenarioRuns) {
      if (run.status === 'QUEUED') {
        run.status = 'CANCELED';
        queuedCanceled++;
      } else if (run.status === 'RUNNING' && run.errorCode !== 'cancel-requested') {
        run.errorCode = 'cancel-requested';
        runningRequested++;
      }
    }
    return send({ queuedCanceled, runningRequested });
  }
  if (path === base + '/runs') {
    const ids = requestUrl.searchParams.get('ids')?.split(',');
    if (ids) {
      trackedRunRequests.push(ids);
      if (trackingFailures > 0) {
        trackingFailures--;
        return send({ message: 'Seguimiento temporalmente no disponible.' }, 503);
      }
      return send(scenarioRuns.filter(run => ids.includes(run.id)));
    }
    const runs = reportMode ? reportRuns : scenarioRuns;
    const history = requestUrl.searchParams.get('view') === 'report' ? runs.filter(run => run.status !== 'CANCELED') : runs;
    return reportForbidden ? send({ message: 'Sin permisos' }, 403) : historyFail ? send({ message: 'Historial no disponible' }, 503) : send(history);
  }
  if (path === `${base}/runs/${reportRuns[0].id}/trace/${reportRuns[0].results[0].id}`) {
    response.setHeader('Content-Type', 'application/zip'); response.setHeader('Content-Disposition', 'attachment; filename="trace.zip"');
    const archive = new JSZip(); archive.file('trace.fixture.json', '{"synthetic":true}');
    return response.end(await archive.generateAsync({ type: 'nodebuffer' }));
  }
  if (path === base && request.method === 'PUT') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    project = { ...project, ...payload, revision: project.revision + 1,
      environments: payload.environments.map((env, i) => {
        const previous = project.environments[i];
        const authorizedAt = env.authorizationConfirmed
          ? (previous?.readOnly === env.readOnly && previous?.authorizedAt) || '2026-11-19T13:00:00Z'
          : null;
        return { ...previous, ...env, authorizedAt };
      }) };
    saveCount++;
    return send(project);
  }
  if (path === base) return send(project);
  if (path === base + '/ipa') return ipaFail ? send({ message: 'IPA no disponible' }, 503) : send({ ipa: qualityMode ? { ...ipa,
    documents: { declared: 1, uploaded: 3, processed: 2, validated: 1 }, verifiable: 7, ambiguous: 2, blockers: [], hints: ['Revisa el timeout.'] } : ipa,
    generatedAt: '2026-11-18T12:00:00Z' });
  if (path === base + '/icsp') return qualityIcspFail ? send({ message: 'ICSP no disponible' }, 503) : send(qualityMalformed ? [] : qualityNoResults ? {
    ...qualityIcsp, score: 100, counts: { requirements: 0, scenarios: 0, runs: 0, results: 0, passed: 0, failed: 0 },
    dimensions: qualityIcsp.dimensions.map(dimension => ({ ...dimension, numerator: 0, denominator: 0 })),
  } : qualityIcsp);
  if (path === base + '/ipa/history') return send(qualityEmptyHistory ? [] : [{ id: 'ipa-history-1', score: 82, delta: 82, createdAt: '2026-11-18T12:00:00Z' }, { id: 'ipa-history-2', score: 0, delta: null, createdAt: '2026-11-17T12:00:00Z' }]);
  if (path === base + '/icsp/history') return send(qualityEmptyHistory ? [] : [{ id: 'icsp-history-1', score: 88, delta: null, createdAt: '2026-11-18T12:00:00Z' }]);
  if (path === base + '/audits') {
    if (request.method === 'POST') { auditPosts++; return send({ message: 'No debe iniciar auditorías en estas pruebas' }, 503); }
    return qualityAuditForbidden ? send({ message: 'Sin acceso' }, 403) : send(qualityMode ? [{ id: 'audit-1', status: 'COMPLETED', createdAt: '2026-11-18T11:00:00Z', completedAt: '2026-11-18T11:01:00Z',
      performanceScore: 94, accessibilityScore: 0, bestPracticesScore: 90, seoScore: 88, lcpMs: 2200, tbtMs: 0, cls: 0, fcpMs: 1100 }] : []);
  }
  if (path === base + '/report/export' && (reportMode ? reportRuns : scenarioRuns).some(run => ['QUEUED', 'RUNNING'].includes(run.status))) {
    return send({ message: 'El reporte estará disponible cuando finalicen las ejecuciones del proyecto.' }, 409);
  }
  if (path === base + '/report/export' && reportMode && !reportRuns.some(run => ['COMPLETED', 'FAILED'].includes(run.status))) {
    return send({ message: 'El reporte estará disponible después de la primera ejecución finalizada.' }, 409);
  }
  if (path === base + '/report/export') return qualityExportFail ? send({ message: 'Exportación no disponible' }, 503) : send({
    project: { id: project.id, name: project.name, status: project.status }, ipa, icsp: qualityIcsp, traceability: [], generatedAt: '2026-11-18T12:00:00Z',
  });
  if (path === base + '/documents') return docsFail ? send({ message: 'Documentos temporalmente no disponibles.' }, 503) : send(documents);
  if (path === base + '/documents/analysis') return send({ analysis: null, ipa: { ...ipa, verifiable: 0, ambiguous: 0,
    documents: { declared: 1, uploaded: 3, processed: 2, validated: 1 }, signals: [], recommendations: [] } });
  if (path.startsWith(base + '/')) return send([]);
  return send({ message: 'No encontrado' }, 404);
});

async function verifyScenarioPagination(page, automation = false) {
  const original = scenarios;
  scenarios = Array.from({ length: 35 }, (_, i) => ({
    id: '73000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
    title: 'Caso paginado ' + (i + 1),
    tags: [i % 2 ? '@par' : '@impar'],
    steps: [],
  }));
  try {
    await page.reload();
    await page.getByRole('tab', { name: automation ? 'Automatización' : 'Escenarios (35)', exact: true }).click();
    const panel = page.getByRole('region', { name: automation ? 'Automatización Playwright' : 'Gestión de escenarios', exact: true });
    const pagination = panel.getByRole('navigation', { name: automation ? 'Paginación de automatización' : 'Paginación de escenarios' });
    const pageSize = pagination.getByRole('combobox', { name: 'Escenarios por página' });
    const nextPage = pagination.getByRole('button', { name: 'Página siguiente' });
    const previousPage = pagination.getByRole('button', { name: 'Página anterior' });
    const list = panel.getByRole('list', { name: automation ? 'Escenarios para Playwright' : 'Escenarios del proyecto', exact: true });
    const rows = list.locator(':scope > li');
    const search = panel.getByRole('searchbox', { name: automation ? 'Buscar escenarios para Playwright' : 'Buscar escenarios', exact: true });
    const toolbar = panel.getByRole('region', { name: automation ? 'Buscar y filtrar automatización' : 'Buscar y filtrar escenarios', exact: true });
    await expect(pageSize).toHaveValue('10');
    await expect(rows).toHaveCount(10);
    await expect(previousPage).toBeDisabled();
    const listBounds = await list.boundingBox();
    const paginationBounds = await pagination.boundingBox();
    assert.ok(paginationBounds.y >= listBounds.y + listBounds.height, 'La paginaci\u00f3n queda debajo del listado.');
    await expect(pagination.getByRole('status')).toHaveText('1–10 de 35 · Página 1 de 4');
    await toolbar.getByRole('checkbox', { name: 'Seleccionar visibles (10)', exact: true }).uncheck();
    if (automation) await expect(panel.getByRole('button', { name: 'Generar seleccionados (25)', exact: true })).toBeEnabled();

    await nextPage.click();
    await expect(rows.first()).toContainText('Caso paginado 11');
    await expect(list).toBeFocused();
    await expect(rows.first()).toBeInViewport();
    await expect(rows.first().getByRole('checkbox')).toBeChecked();
    await expect(toolbar.getByRole('status')).toContainText('25 seleccionados');
    await previousPage.click();
    await expect(rows.first().getByRole('checkbox')).not.toBeChecked();

    await pageSize.selectOption('20');
    await expect(rows).toHaveCount(20);
    await nextPage.click();
    await expect(rows).toHaveCount(15);
    await expect(nextPage).toBeDisabled();
    await pageSize.selectOption('30');
    await expect(rows).toHaveCount(30);
    await nextPage.click();
    await expect(rows).toHaveCount(5);
    await expect(pagination.getByRole('status')).toHaveText('31–35 de 35 · Página 2 de 2');

    await search.fill('Caso paginado 35');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Caso paginado 35');
    await expect(pagination.getByRole('status')).toHaveText('1–1 de 1 · Página 1 de 1');
    await search.clear();
    await pageSize.selectOption('10');
    await nextPage.click();
    await toolbar.getByRole('button', { name: '@par (17)', exact: true }).click();
    await expect(pagination.getByRole('status')).toHaveText('1–10 de 17 · Página 1 de 2');
    await expect(rows.first()).toContainText('Caso paginado 2');

    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    console.log('PASS paginación de ' + (automation ? 'Automatización' : 'Escenarios') + ': tamaños, navegación, búsqueda, filtros y selección por página.');
  } finally {
    scenarios = original;
    await page.setViewportSize({ width: 1440, height: 1100 });
  }
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.reload();
}

async function verifyScenarios(page, screenshots) {
  async function headerGeometry() {
    await page.evaluate(() => window.scrollTo(0, 0));
    return page.evaluate(() => {
      const box = selector => {
        const element = [...document.querySelectorAll(selector)].find(element => element.getClientRects().length);
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width };
      };
      const heading = [...document.querySelectorAll('.project-heading')].find(element => element.getClientRects().length);
      const style = getComputedStyle(heading);
      return { body: box('.app-shell-body'), breadcrumb: box('.project-breadcrumb-row'), title: box('.project-heading h1'),
        titleSize: getComputedStyle(heading.querySelector('h1')).fontSize,
        background: style.backgroundColor, border: style.borderTopWidth,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft] };
    });
  }
  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    const dataHeader = await headerGeometry();
    await page.getByRole('tab', { name: /^Escenarios \(3\)$/ }).click();
    const scenarioHeader = await headerGeometry();
    assert.deepEqual(scenarioHeader, dataHeader, `Datos y Escenarios comparten ancho, posición, tipografía y fondo a ${width}px.`);
    assert.equal(scenarioHeader.background, 'rgba(0, 0, 0, 0)', 'El título no tiene tarjeta blanca.');
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
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
  await expect(execute).toBeDisabled();
  await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
  const automation = page.getByRole('region', { name: 'Automatización Playwright', exact: true });
  await expect(automation.locator('.automation-pick-list > li')).toHaveCount(4);
  await automation.getByRole('checkbox', { name: 'Seleccionar visibles (4)', exact: true }).check();
  await automation.getByRole('button', { name: 'Generar seleccionados (4)', exact: true }).click();
  await expect(automation.getByText('2 con código guardado · 2 en revisión.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Escenarios (4)', exact: true }).click();
  await expect(execute).toBeEnabled();
  const pendingScenario = list.getByRole('checkbox', { name: `Seleccionar ${scenarios[2].title}`, exact: true });
  await pendingScenario.check();
  await expect(page.getByRole('button', { name: 'Ejecutar suite (2)', exact: true })).toBeDisabled();
  await pendingScenario.uncheck();
  await execute.click();
  let dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await expect(dialog.getByLabel('Entorno autorizado').locator('option')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(queuedRequests.length, 0, 'Cancelar la confirmación no encola nada.');
  await execute.click();
  dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ejecución', exact: true }).click();
  await expect(dialog.getByText('Procesando…', { exact: true })).toBeVisible();
  assert.deepEqual(queuedRequests, [{ scenarioId: scenarioA, environmentId: environment.id, automationId: fixtureSpec(scenarios[0]).automationId }]);
  await finishFixtureRun(dialog);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(list.locator('.scenario-result').filter({ hasText: 'Pago sandbox editado' }).getByText('Pasó · 450 ms', { exact: true })).toBeVisible();
  await list.getByRole('checkbox', { name: 'Seleccionar Pago sandbox editado', exact: true }).uncheck();
  await list.getByRole('checkbox', { name: `Seleccionar ${scenarios[1].title}`, exact: true }).check();
  await execute.click();
  dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ejecución', exact: true }).click();
  await expect(dialog.getByText('Cuota de ejecuciones alcanzada.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('La suite no se inició.');
  await expect(dialog.getByRole('button', { name: 'Ver reporte', exact: true })).toBeDisabled();
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
  await expect(list.getByText('Pasó · 450 ms', { exact: true })).toBeVisible();
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

async function verifyManualScenario(page) {
  const automatic = scenarios;
  const title = 'Revisión manual de claridad';
  const action = 'Comprueba si el mensaje explica cómo volver a intentar.';
  scenarios = [...automatic, {
    id: '40000000-0000-4000-8000-000000000098', title, tags: ['@manual', '@regresion'],
    steps: [{ ordinal: 1, action }], expectedResult: 'El mensaje explica cómo continuar.',
    requirementId: null, requirement: null, _count: { results: 0 },
  }];
  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Escenarios (' + (automatic.length + 1) + ')', exact: true }).click();
    await page.getByRole('button', { name: '@manual (1)', exact: true }).click();
    const list = page.getByRole('list', { name: 'Escenarios del proyecto', exact: true });
    await expect(list.locator('.scenario-result')).toHaveCount(1);
    await list.getByRole('button', { name: title, exact: true }).click();
    const detail = page.getByRole('complementary', { name: 'Detalle del escenario seleccionado' });
    await expect(detail.getByText(action, { exact: true })).toBeVisible();
    await expect(detail.getByText('El mensaje explica cómo continuar.', { exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Ejecutar escenario seleccionado', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Ejecutar suite (' + automatic.length + ')', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    const automation = page.getByRole('region', { name: 'Automatización Playwright', exact: true });
    await expect(automation.locator('.automation-pick-list > li')).toHaveCount(automatic.length);
    await expect(automation.getByText(title, { exact: true })).toHaveCount(0);
    console.log('PASS escenario manual: filtro, pasos, resultado esperado y exclusión de Playwright.');
  } finally {
    scenarios = automatic;
  }
  await page.reload();
}

async function verifySavedAutomationAfterReload(page) {
  const initialQueues = queuedRequests.length;
  const initialRuns = scenarioRuns.length;
  const originalSecondTitle = scenarios[1].title;
  const section = page.getByRole('region', { name: 'Automatización Playwright', exact: true });
  const states = section.getByRole('group', { name: 'Filtrar por estado del código' });
  const rows = section.locator('.automation-pick-list > li');
  const second = rows.filter({ hasText: scenarios[1].title });
  const runner = page.getByRole('button', { name: 'Ejecutar en runners (2)', exact: true });

  try {
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await second.getByRole('button', { name: scenarios[1].title, exact: true }).click();
    await expect(section.locator('.automation-source')).toContainText(scenarios[1].title);
    await expect(second.getByText('Pendiente', { exact: true })).toBeVisible();
    await expect(states.getByRole('button', { name: 'Generado (0)', exact: true })).toBeVisible();
    await rows.nth(2).getByRole('checkbox').uncheck();
    await section.getByRole('button', { name: 'Generar seleccionados (2)', exact: true }).click();
    await expect(runner).toBeEnabled();
    await expect(section.getByText('2 con código guardado.', { exact: true })).toBeVisible();

    const requestStart = previewRequests.length;
    await page.reload();
    await states.getByRole('button', { name: 'Generado (2)', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(second.getByText('Generado', { exact: true })).toBeVisible();
    await expect(second.getByText(/payment-declined\.spec\.ts$/)).toBeVisible();
    assert.ok(!previewRequests.slice(requestStart).includes(scenarioB));
    await runner.click();
    const dialog = page.getByRole('dialog', { name: 'Ejecutar suite (2)', exact: true });
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Confirmar ejecución' }).click();
    await expect(dialog.getByText('Cuota de ejecuciones alcanzada.', { exact: true })).toBeVisible();
    assert.deepEqual(queuedRequests.slice(initialQueues).map(request => request.automationId),
      scenarios.slice(0, 2).map(scenario => fixtureSpec(scenario).automationId));
    await finishFixtureRun(dialog);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();

    scenarios[1].title += ' · editado';
    await section.getByRole('button', { name: 'Actualizar escenarios de automatización' }).click();
    await expect(states.getByRole('button', { name: 'Generado (1)', exact: true })).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(states.getByRole('button', { name: 'Pendiente (2)', exact: true })).toBeVisible();
  } finally {
    savedPlaywright.delete(scenarioA);
    savedPlaywright.delete(scenarioB);
    scenarios[1].title = originalSecondTitle;
    queuedRequests.length = initialQueues;
    scenarioRuns.length = initialRuns;
  }
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.reload();
  console.log('PASS los estados de código guardado se mantienen al recargar y al filtrar sin abrir cada caso.');
}

async function verifySuiteProgress(page) {
  const initialQueues = queuedRequests.length;
  const initialRuns = scenarioRuns.length;
  const firstPoll = trackedRunRequests.length;
  const extra = { ...scenarios[0], id: randomUUID(), title: 'Compra con código promocional' };

  try {
    scenarios.push(extra);
    [scenarios[0], scenarios[1], extra].forEach(persistFixtureSpec);
    trackingFailures = 1;
    runCapacity = 1;
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await page.getByRole('button', { name: 'Ejecutar en runners (3)', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ejecutar suite (3)', exact: true });
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Confirmar ejecución' }).click();
    const rows = dialog.getByRole('listitem');
    const first = rows.filter({ hasText: scenarios[0].title });
    const last = rows.filter({ hasText: extra.title });
    await expect(dialog.getByText('Cuota de ejecuciones alcanzada.', { exact: true })).toBeVisible();
    await expect(dialog.getByText('No ejecutado', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText(/^Procesando… 1 de 3/)).toBeVisible();
    await expect(dialog.getByText(/No se pudo actualizar el estado/)).toBeVisible();

    await expect(last.getByText('Esperando turno…', { exact: true })).toBeVisible();
    const close = dialog.getByRole('button', { name: 'Cerrar', exact: true });
    const report = dialog.getByRole('button', { name: 'Ver reporte', exact: true });
    await expect(close).toBeEnabled();
    await expect(report).toBeDisabled();
    await close.click();
    await expect(dialog).toBeHidden();

    await page.getByRole('tab', { name: /^Escenarios/ }).click();
    await page.getByRole('button', { name: 'Ver suite', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(report).toBeDisabled();
    await close.click();
    await expect(dialog).toBeHidden();

    assert.equal(scenarioRuns.length - initialRuns, 1);
    const passed = scenarioRuns[initialRuns];
    assert.deepEqual(trackedRunRequests[firstPoll], [passed.id]);
    completeFixtureRun(passed);
    await expect.poll(() => scenarioRuns.length - initialRuns, { timeout: 10000 }).toBe(2);
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await page.getByRole('button', { name: 'Ver suite', exact: true }).click();
    await expect(first.getByText('Pasó', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(report).toBeDisabled();
    await expect(last.getByText('Procesando…', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText(/^Procesando… 2 de 3/)).toBeVisible();
    await expect(dialog.getByText(/No se pudo actualizar el estado/)).toHaveCount(0);

    const failed = scenarioRuns[initialRuns + 1];
    failed.status = 'FAILED';
    await expect(last.getByText('Falló', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByRole('status')).toHaveText('Ejecuciones finalizadas (2/3).');
    await expect(dialog.getByText('En cola', { exact: false })).toHaveCount(0);
    assert.deepEqual(scenarioRuns.slice(initialRuns).map(run => run.scenarioId), [scenarioA, extra.id]);
    assert.equal(queuedRequests.slice(initialQueues).filter(request => request.scenarioId === scenarioA).length, 1);
    assert.ok(queuedRequests.slice(initialQueues).filter(request => request.scenarioId === extra.id).length > 1);
    assert.deepEqual(trackedRunRequests.at(-1), [failed.id]);
    await expect(dialog.getByRole('link', { name: 'Ver reporte', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  } finally {
    trackingFailures = 0;
    runCapacity = Infinity;
    queuedRequests.length = initialQueues;
    scenarioRuns.length = initialRuns;
    [scenarioA, scenarioB, extra.id].forEach(id => savedPlaywright.delete(id));
    scenarios = scenarios.filter(scenario => scenario.id !== extra.id);
  }
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.reload();
  console.log('PASS Cerrar oculta la suite y la ejecución sigue; Ver reporte se habilita al terminar.');
}

async function verifyAutomationRunStatus(page) {
  const initialRuns = scenarioRuns.length;
  const queued = { ...scenarioRuns[0], id: randomUUID(), status: 'QUEUED', results: [] };

  try {
    scenarioRuns.push(queued);
    activityUnavailable = true;
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    const indicator = page.getByRole('region', { name: 'Estado de ejecución', exact: true });
    const status = indicator.getByRole('status');
    const viewer = page.getByRole('region', { name: 'Visor de código Playwright', exact: true });
    await expect(status).toHaveText('No se pudo consultar el estado.');
    const indicatorBounds = await indicator.boundingBox();
    const viewerBounds = await viewer.boundingBox();
    assert.ok(indicatorBounds.y + indicatorBounds.height <= viewerBounds.y);

    activityUnavailable = false;
    await expect(status).toHaveText('0 en ejecución · 1 en cola', { timeout: 10000 });
    const stop = indicator.getByRole('button', { name: 'Detener ejecución', exact: true });
    await expect(stop).toBeEnabled();
    queued.status = 'RUNNING';
    const pending = { ...queued, id: randomUUID(), status: 'QUEUED' };
    scenarioRuns.push(pending);
    await expect(status).toHaveText('1 en ejecución · 1 en cola', { timeout: 10000 });
    const initialStops = stopRequests;
    await stop.click();
    await expect(status).toHaveText('0 en ejecución · 0 en cola · 1 deteniéndose');
    await expect(indicator.getByRole('button', { name: 'Deteniendo…' })).toBeDisabled();
    assert.equal(stopRequests, initialStops + 1);
    assert.equal(pending.status, 'CANCELED');
    assert.equal(queued.status, 'RUNNING');
    queued.status = 'CANCELED';
    await expect(status).toHaveText('Sin ejecuciones en curso ni en cola.', { timeout: 10000 });
    await expect(stop).toHaveCount(0);
  } finally {
    activityUnavailable = false;
    scenarioRuns.length = initialRuns;
  }

  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.reload();
  console.log('PASS el indicador cancela la cola y muestra Deteniendo hasta que el runner confirma.');
}

async function verifyStopSuiteDuringSubmission(page) {
  const initialQueues = queuedRequests.length;
  const initialRuns = scenarioRuns.length;
  const initialStops = stopRequests;
  let release;
  try {
    scenarios.slice(0, 2).forEach(persistFixtureSpec);
    runAdmission = new Promise(resolve => { release = resolve; });
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await page.getByRole('button', { name: 'Ejecutar en runners (2)', exact: true }).click();
    const suite = page.getByRole('dialog', { name: 'Ejecutar suite (2)', exact: true });
    await suite.getByRole('checkbox').check();
    await suite.getByRole('button', { name: 'Confirmar ejecución' }).click();
    await expect.poll(() => queuedRequests.length - initialQueues).toBe(1);
    await suite.getByRole('button', { name: 'Cerrar', exact: true }).click();
    const indicator = page.getByRole('region', { name: 'Estado de ejecución', exact: true });
    await indicator.getByRole('button', { name: 'Detener ejecución', exact: true }).click();
    await expect(indicator.getByRole('button', { name: 'Deteniendo…' })).toBeDisabled();
    assert.equal(stopRequests, initialStops);
    release();

    await expect(indicator.getByRole('button', { name: 'Deteniendo…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ejecutar en runners (2)', exact: true })).toBeEnabled();
    assert.equal(stopRequests, initialStops + 1);
    assert.equal(queuedRequests.length - initialQueues, 1);
    assert.equal(scenarioRuns[initialRuns].status, 'CANCELED');
  } finally {
    release?.();
    runAdmission = null;
    savedPlaywright.delete(scenarioA);
    savedPlaywright.delete(scenarioB);
    queuedRequests.length = initialQueues;
    scenarioRuns.length = initialRuns;
  }
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.reload();
  console.log('PASS detener espera el envío en curso y cancela antes de enviar más escenarios.');
}

async function verifyAutomationToolbar(page) {
  persistFixtureSpec(scenarios[0]);
  await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
  const section = page.getByRole('region', { name: 'Automatización Playwright' });
  const toolbar = section.getByRole('region', { name: 'Buscar y filtrar automatización' });
  const states = toolbar.getByRole('group', { name: 'Filtrar por estado del código' });
  const tags = toolbar.getByRole('group', { name: 'Filtrar por etiqueta' });
  const search = toolbar.getByRole('searchbox', { name: 'Buscar escenarios para Playwright' });
  const rows = section.locator('.automation-pick-list > li');
  await expect(rows).toHaveCount(3);
  await expect(states.getByRole('button', { name: 'Generado (1)', exact: true })).toBeVisible();
  await states.getByRole('button', { name: 'Pendiente (2)', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await tags.getByRole('button', { name: '@apiRest (1)', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await toolbar.getByRole('checkbox', { name: 'Seleccionar visibles (1)', exact: true }).uncheck();
  await expect(toolbar.getByRole('status')).toHaveText('2 seleccionados · 1 visibles');
  await expect(section.getByRole('button', { name: 'Generar seleccionados (2)', exact: true })).toBeEnabled();

  await tags.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await states.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await search.fill(fixtureSpec(scenarios[0]).filename);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(scenarios[0].title);
  await search.clear();

  specFailure = true;
  try {
    await rows.getByRole('button', { name: scenarios[1].title, exact: true }).click();
    await states.getByRole('button', { name: 'Error (1)', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(scenarios[1].title);
  } finally {
    specFailure = false;
  }
  await states.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await rows.getByRole('button', { name: scenarios[2].title, exact: true }).click();
  await states.getByRole('button', { name: 'Requiere revisión (1)', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(scenarios[2].title);
  await search.fill('ninguna coincidencia');
  await expect(section.getByRole('heading', { name: 'No hay coincidencias', exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first().getByRole('checkbox')).toBeChecked();
  await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked();

  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.reload();
  savedPlaywright.delete(scenarioA);
  console.log('PASS filtros de automatización: búsqueda por archivo, estado, etiquetas y selección visible.');
}

async function verifyWritableExecution(page) {
  const automationId = persistFixtureSpec(scenarios[0]);
  const originalProject = project;
  const originalSaveCount = saveCount;
  const initialQueues = queuedRequests.length;
  const initialRuns = scenarioRuns.length;
  const qa = { ...project.environments[1], authorizationConfirmed: true, authorizedAt: '2026-11-17T13:00:00Z' };
  const production = {
    ...qa, id: '10000000-0000-4000-8000-000000000004', type: 'PRODUCTION', baseUrl: 'https://production.example.test/',
  };
  project = { ...project, environments: [environment, qa, production] };

  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await page.getByRole('button', { name: 'Ejecutar en runners (1)', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
    const environmentSelect = dialog.getByLabel('Entorno autorizado');
    const configure = dialog.getByRole('button', { name: 'Configurar cambios con datos de prueba' });
    await environmentSelect.selectOption(production.id);
    await expect(configure).toHaveCount(0);
    await environmentSelect.selectOption(qa.id);
    await dialog.getByRole('checkbox', { name: /en solo lectura/ }).check();
    await configure.click();
    const settings = page.getByRole('dialog', { name: 'Entornos y alcance' });
    await settings.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(environmentSelect).toHaveValue(qa.id);
    assert.equal(project.environments[1].readOnly, true);
    assert.equal(queuedRequests.length, initialQueues);
    await configure.click();

    const selectedQa = settings.getByRole('group', { name: 'Entorno 2', exact: true });
    const authorization = selectedQa.getByRole('checkbox', { name: /Confirmo que tengo autorización/ });
    const writeMode = selectedQa.getByRole('checkbox', { name: 'Permitir cambios con datos de prueba' });
    await expect(writeMode).toBeFocused();
    await expect(authorization).toBeChecked();
    await writeMode.check();
    await expect(authorization).not.toBeChecked();
    await authorization.check();
    await settings.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(settings).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(environmentSelect).toHaveValue(qa.id);
    assert.equal(project.environments[1].readOnly, false);
    assert.equal(project.environments[0].readOnly, true);
    assert.notEqual(project.environments[1].authorizedAt, qa.authorizedAt);
    assert.equal(queuedRequests.length, initialQueues);
    const confirm = dialog.getByRole('button', { name: 'Confirmar ejecución' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /cambios en los datos de prueba/ }).check();
    await confirm.click();
    await expect(dialog.getByText('Procesando…', { exact: true })).toBeVisible();
    assert.deepEqual(queuedRequests.at(-1), {
      scenarioId: scenarioA,
      environmentId: qa.id,
      writeAuthorizationAt: project.environments[1].authorizedAt,
      automationId,
    });
    await finishFixtureRun(dialog);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await page.getByLabel('Entorno seleccionado').selectOption(qa.id);
    await expect(page.getByText('Cambios con datos de prueba', { exact: true })).toBeVisible();
  } finally {
    savedPlaywright.delete(scenarioA);
    project = originalProject;
    saveCount = originalSaveCount;
    queuedRequests.length = initialQueues;
    scenarioRuns.length = initialRuns;
  }
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.reload();
  console.log('PASS autorización de cambios en el QA seleccionado desde la suite, confirmación y sincronización con Datos.');
}

async function verifyAutomation(page, screenshots) {
  const section = page.getByRole('region', { name: 'Automatización Playwright', exact: true });
  const rows = section.locator('.automation-pick-list > li');
  const source = section.locator('.automation-source');
  const initialQueues = queuedRequests.length;
  await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await expect(source).toContainText(fixtureSpec(scenarios[0]).code.split('\n')[0]);
  const generation = section.getByRole('region', { name: 'Generar código Playwright' });
  const generate = generation.getByRole('button', { name: 'Generar seleccionados (4)', exact: true });
  await expect(generate).toBeVisible();
  await expect(section.getByRole('button', { name: /^Generar seleccionados/ })).toHaveCount(1);
  const cardBounds = await generation.boundingBox();
  const workspaceBounds = await section.locator('.automation-workspace').boundingBox();
  assert.ok(cardBounds.y + cardBounds.height <= workspaceBounds.y, 'El bloque de generación queda encima de la lista y el visor.');
  await generate.click();
  await expect(section.getByText('2 con código guardado · 2 en revisión.', { exact: true })).toBeVisible();
  await expect(section.locator('.automation-generation-state').getByText('Generado', { exact: true })).toHaveCount(2);
  await expect(section.locator('.automation-generation-state').getByText('Requiere revisión', { exact: true })).toHaveCount(2);
  assert.equal(queuedRequests.length, initialQueues, 'Generar y visualizar no encola ejecuciones.');
  await section.getByRole('tab', { name: 'payment-declined.spec.ts', exact: true }).click();
  await expect(source).toContainText('<img src=x onerror="window.autoqaInjected=true">');
  await expect(source.locator('img')).toHaveCount(0);
  assert.equal(await page.evaluate(() => !!window.autoqaInjected), false, 'El código recibido se presenta como texto.');
  await section.getByRole('tab', { name: fixtureSpec(scenarios[0]).filename, exact: true }).click();
  await page.setViewportSize({ width: 1170, height: 1000 });
  const picker = await section.locator('.automation-scenarios').boundingBox();
  const editor = await section.locator('.automation-editor').boundingBox();
  assert.ok(picker.x + picker.width <= editor.x, 'La selección queda a la izquierda del código.');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(screenshots, 'project-automation-desktop.png'), fullPage: true, animations: 'disabled' });
  const firstFile = fixtureSpec(scenarios[0]).filename;
  await section.getByRole('tab', { name: firstFile, exact: true }).click();
  await section.getByRole('button', { name: 'Copiar código', exact: true }).click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), fixtureSpec(scenarios[0]).code);
  const configTab = section.getByRole('tab', { name: 'playwright.config.ts', exact: true });
  await configTab.click();
  await expect(source).toContainText('process.env.AUTOQA_BASE_URL');
  await section.getByRole('button', { name: 'Copiar código', exact: true }).click();
  const configText = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  await configTab.focus(); await page.keyboard.press('Home');
  await expect(section.getByRole('tab', { name: firstFile, exact: true })).toHaveAttribute('aria-selected', 'true');
  await section.getByRole('button', { name: 'Ampliar visor de código', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await section.getByRole('button', { name: 'Restaurar visor de código', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  const zipDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar .spec.ts (.zip)', exact: true }).click();
  const download = await zipDownload;
  assert.equal(download.suggestedFilename(), 'autoqa-playwright.zip');
  const zip = await JSZip.loadAsync(await readFile(await download.path()), { checkCRC32: true });
  const zipNames = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  assert.equal(zipNames.filter(name => name.endsWith('.spec.ts')).length, 4);
  assert.ok(zipNames.every(name => !name.includes('..') && !name.startsWith('/') && !name.includes('\\')));
  assert.equal(await zip.file('playwright.config.ts').async('string'), configText);
  const firstPath = zipNames.find(name => name.includes(scenarioA) && name.endsWith('.spec.ts'));
  assert.equal(await zip.file(firstPath).async('string'), fixtureSpec(scenarios[0]).code);
  const allContents = (await Promise.all(zipNames.map(name => zip.file(name).async('string')))).join('\n');
  assert.ok(!allContents.includes('synthetic-private-identity') && !allContents.includes('vault:synthetic-private-reference'));
  assert.ok((await zip.file('README.md').async('string')).includes('Revisar:'));

  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const original = await page.locator('.app-shell-body').boundingBox();
    const originalTitle = await page.locator('.project-heading:visible h1').evaluate(node => ({ x: node.getBoundingClientRect().x, size: getComputedStyle(node).fontSize }));
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const automated = await page.locator('.app-shell-body').boundingBox();
    const automatedTitle = await page.locator('.project-heading:visible h1').evaluate(node => ({ x: node.getBoundingClientRect().x, size: getComputedStyle(node).fontSize }));
    assert.equal(original.x, automated.x); assert.equal(original.width, automated.width); assert.deepEqual(originalTitle, automatedTitle);
    assert.equal(await page.locator('.project-heading:visible').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Automatización sin desbordamiento a ${width}px.`);
    if (width === 390) {
      const mobilePicker = await section.locator('.automation-scenarios').boundingBox(); const mobileEditor = await section.locator('.automation-editor').boundingBox();
      assert.ok(mobilePicker.y + mobilePicker.height <= mobileEditor.y);
      await page.screenshot({ path: join(screenshots, 'project-automation-mobile.png'), fullPage: true, animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  const all = section.getByRole('checkbox', { name: 'Seleccionar visibles (4)', exact: true });
  await all.uncheck();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[0].title}`, exact: true }).check();
  const execute = page.getByRole('button', { name: 'Ejecutar en runners (1)', exact: true });
  await execute.click();
  let dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(queuedRequests.length, initialQueues);
  await execute.click(); dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ejecución', exact: true }).click();
  await expect(dialog.getByText('Procesando…', { exact: true })).toBeVisible();
  assert.equal(queuedRequests.at(-1).environmentId, environment.id);
  await finishFixtureRun(dialog);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[0].title}`, exact: true }).uncheck();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[2].title}`, exact: true }).check();
  await expect(page.getByRole('button', { name: 'Ejecutar en runners (0)', exact: true })).toBeDisabled();
  await expect(section.getByText('Sin pasos definidos', { exact: false }).first()).toBeVisible();

  scenarios[1].title += ' · contrato actualizado';
  malformedSpec = true;
  await section.getByRole('button', { name: 'Actualizar escenarios de automatización', exact: true }).click();
  await section.getByRole('button', { name: scenarios[1].title, exact: true }).click();
  await expect(section.getByText('La API no devolvió un archivo de código válido.', { exact: true }).first()).toBeVisible();
  malformedSpec = false; specFailure = true;
  await section.getByRole('button', { name: 'Reintentar archivo', exact: true }).click();
  await expect(section.getByText('Generador temporalmente no disponible.', { exact: true }).first()).toBeVisible();
  await all.uncheck();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[1].title}`, exact: true }).check();
  let unexpectedDownloads = 0;
  const recordDownload = () => { unexpectedDownloads++; };
  page.on('download', recordDownload);
  await page.getByRole('button', { name: 'Descargar .spec.ts (.zip)', exact: true }).click();
  await expect(section.getByText(/no se descargó un ZIP incompleto/)).toBeVisible();
  assert.equal(unexpectedDownloads, 0); page.off('download', recordDownload);
  specFailure = false;
  await section.getByRole('button', { name: 'Reintentar archivo', exact: true }).click();
  await expect(rows.filter({ hasText: scenarios[1].title }).getByText('Generado', { exact: true })).toBeVisible();
  await expect(source).toContainText(scenarios[1].title);
  await page.getByRole('button', { name: 'Ejecutar en runners (1)', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ejecución', exact: true }).click();
  await expect(dialog.getByText('Cuota de ejecuciones alcanzada.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  scenariosFail = true;
  await page.reload();
  await expect(section.getByText('No se pudo cargar la lista de automatización.', { exact: true })).toBeVisible();
  scenariosFail = false;
  await section.getByRole('button', { name: 'Reintentar automatización', exact: true }).click();
  await expect(rows).toHaveCount(4);
  const populated = scenarios; scenarios = [];
  await page.reload();
  await expect(section.getByRole('heading', { name: 'Aún no hay escenarios para automatizar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar .spec.ts (.zip)', exact: true })).toBeDisabled();
  scenarios = populated;
  project.status = 'DRAFT';
  await page.reload();
  await section.getByRole('button', { name: 'Generar seleccionados (4)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ejecutar en runners (2)', exact: true })).toBeDisabled();
  project.status = 'READY';
  await page.reload();
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  console.log('PASS automatización: contrato filename/code, visor seguro, archivos/teclado, copiar, pantalla completa, ZIP con CRC/rutas/contenido, revisión sin falsos validados, cabecera común/móvil, confirmación y cuota, caché invalidada, errores y reintentos. API simulada, sin worker real.');
}

async function verifyRunReport(page, screenshots) {
  reportMode = true;
  const initialQueues = queuedRequests.length;
  await page.getByRole('tab', { name: 'Reporte', exact: true }).click();
  const section = page.getByRole('region', { name: 'Reporte de ejecuciones', exact: true });
  const table = section.getByRole('table', { name: 'Ejecuciones registradas', exact: true });
  await expect(table.getByRole('row')).toHaveCount(8);
  await expect(section.getByRole('region', { name: 'Tasa de éxito', exact: true }).getByText('25%', { exact: true })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Tiempo registrado', exact: true }).getByText('4.6 s', { exact: true })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Flakiness y reintentos', exact: true }).getByText('No disponible', { exact: true })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Cobertura de aserciones', exact: true }).getByText('No disponible', { exact: true })).toBeVisible();
  await expect(table.getByText('CHROMIUM', { exact: true })).toBeVisible();
  const evidence = table.getByRole('link', { name: /Descargar traza/ });
  const traceResponse = await page.request.get(new URL(await evidence.getAttribute('href'), page.url()).href);
  assert.equal(traceResponse.status(), 200);
  const traceZip = await JSZip.loadAsync(await traceResponse.body(), { checkCRC32: true });
  assert.ok(traceZip.file('trace.fixture.json'));
  assert.ok(!(await section.textContent()).includes('private-internal-key'));
  await page.setViewportSize({ width: 1170, height: 1000 });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(screenshots, 'project-runs-desktop.png'), fullPage: true, animations: 'disabled' });
  const search = section.getByRole('searchbox', { name: 'Buscar ejecuciones' });
  await page.keyboard.press('Control+k'); await expect(search).toBeFocused();
  await search.fill('callback'); await expect(table.getByRole('row')).toHaveCount(4);
  await search.fill('');
  const filter = section.getByRole('group', { name: 'Estado de ejecución', exact: true });
  await filter.getByRole('button', { name: 'Fallidos (2)', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await filter.getByRole('button', { name: 'Todos (7)', exact: true }).click();
  await page.getByLabel('Ejecución del reporte', { exact: true }).selectOption(reportRuns[3].id);
  await expect(section.getByRole('region', { name: 'Tiempo registrado', exact: true }).getByText('0 ms', { exact: true })).toBeVisible();
  await page.getByLabel('Ejecución del reporte', { exact: true }).selectOption(reportRuns[4].id);
  await expect(section.getByRole('region', { name: 'Tasa de éxito', exact: true }).getByText('Sin resultados', { exact: true })).toBeVisible();
  await page.getByLabel('Ejecución del reporte', { exact: true }).selectOption('all');
  await table.getByRole('row').filter({ hasText: reportRuns[1].id.slice(0, 8) }).getByRole('button', { name: 'Callback rechazado', exact: true }).click();
  const detail = section.getByRole('region', { name: 'Detalle de ejecución', exact: true });
  await detail.getByText('Ver mensaje de error', { exact: true }).click();
  await expect(detail.locator('pre')).toHaveText(reportError);
  await expect(detail.locator('evil')).toHaveCount(0);
  const views = section.getByRole('group', { name: 'Vista del reporte', exact: true });
  await views.getByRole('button', { name: 'Cronología', exact: true }).click();
  await expect(section.getByRole('region', { name: 'Cronología de ejecuciones', exact: true }).getByText('2 de 7 ejecuciones visibles tienen inicio y fin registrados.', { exact: true })).toBeVisible();
  await views.getByRole('button', { name: 'Matriz', exact: true }).click();
  await expect(section.getByRole('table', { name: 'Matriz de estados por escenario', exact: true }).getByRole('row')).toHaveCount(3);
  await views.getByRole('button', { name: 'Ejecuciones', exact: true }).click();
  await page.getByText('Exportar resultados', { exact: true }).click();
  const xmlButton = page.getByRole('button', { name: 'Exportar JUnit XML', exact: true });
  const jsonButton = page.getByRole('button', { name: 'Exportar JSON', exact: true });
  await expect(xmlButton).toBeDisabled();
  await expect(jsonButton).toBeDisabled();
  await expect(page.getByText('El reporte estará disponible cuando finalicen las ejecuciones del proyecto.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Abrir reporte consolidado/ })).toHaveCount(0);
  const consolidated = await page.context().newPage();
  try {
    await consolidated.goto(new URL('/projects/' + projectId + '/report', page.url()).href);
    await expect(consolidated.getByRole('alert').filter({ hasText: 'El reporte estará disponible cuando finalicen las ejecuciones del proyecto.' })).toBeVisible();
    await expect(consolidated.getByRole('link', { name: 'Descargar JSON' })).toHaveCount(0);
  } finally {
    await consolidated.close();
  }
  const firstCanceled = reportRuns[4];
  const secondCanceled = reportRuns[5];
  const selector = page.getByLabel('Ejecución del reporte', { exact: true });
  const firstHistoryItem = section.getByRole('button', { name: 'Seleccionar ejecución ' + firstCanceled.id.slice(0, 8), exact: true });
  await firstHistoryItem.click();
  await expect(detail).toBeVisible();
  firstCanceled.status = 'CANCELED';
  firstCanceled.errorCode = 'canceled-by-user';
  await expect(firstHistoryItem).toHaveCount(0, { timeout: 12000 });
  await expect(selector).toHaveValue('all');
  await expect(selector.locator('option').filter({ hasText: firstCanceled.id.slice(0, 8) })).toHaveCount(0);
  await expect(detail).toHaveCount(0);
  await expect(table.getByText(firstCanceled.id.slice(0, 8), { exact: true })).toHaveCount(0);
  await expect(table.getByText(secondCanceled.id.slice(0, 8), { exact: true })).toBeVisible();
  await expect(xmlButton).toBeDisabled();
  secondCanceled.status = 'CANCELED';
  await expect(xmlButton).toBeEnabled({ timeout: 12000 });
  await expect(table.getByRole('row')).toHaveCount(6);
  const xmlDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar JUnit XML', exact: true }).click();
  const xmlFile = await xmlDownload;
  assert.equal(xmlFile.suggestedFilename(), 'autoqa-runs-junit.xml');
  const xmlText = await readFile(await xmlFile.path(), 'utf8');
  const xmlResult = await page.evaluate(text => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    return { invalid: doc.querySelectorAll('parsererror').length, tests: doc.documentElement.getAttribute('tests'), failures: doc.documentElement.getAttribute('failures'),
      skipped: doc.documentElement.getAttribute('skipped'), errors: doc.documentElement.getAttribute('errors'), cases: doc.querySelectorAll('testcase').length, evil: doc.querySelectorAll('evil').length };
  }, xmlText);
  assert.deepEqual(xmlResult, { invalid: 0, tests: '5', failures: '1', skipped: '2', errors: '1', cases: 5, evil: 0 });
  assert.ok(!xmlText.includes(firstCanceled.id) && !xmlText.includes(secondCanceled.id));
  await page.getByText('Exportar resultados', { exact: true }).click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click();
  const jsonFile = await jsonDownload;
  const jsonText = await readFile(await jsonFile.path(), 'utf8'); const json = JSON.parse(jsonText);
  assert.equal(json.runs.length, 5);
  assert.ok(json.runs.every(run => ['COMPLETED', 'FAILED'].includes(run.status)));
  assert.ok(!jsonText.includes(firstCanceled.id) && !jsonText.includes(secondCanceled.id));
  assert.ok(!jsonText.includes('private-internal-key'));
  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    const before = await page.locator('.app-shell-body').boundingBox();
    await page.getByRole('tab', { name: 'Reporte', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(6);
    const after = await page.locator('.app-shell-body').boundingBox();
    assert.equal(before.x, after.x); assert.equal(before.width, after.width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Reporte sin desbordamiento a ${width}px.`);
    if (width === 390) await page.screenshot({ path: join(screenshots, 'project-runs-mobile.png'), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('link', { name: 'Nueva ejecución →', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Automatización', exact: true })).toHaveAttribute('aria-selected', 'true');
  assert.equal(queuedRequests.length, initialQueues, 'Nueva ejecución navega al flujo de preparación, sin lanzar trabajos.');
  await page.getByRole('tab', { name: 'Reporte', exact: true }).click();
  historyFail = true;
  await section.getByRole('button', { name: 'Actualizar reporte', exact: true }).click();
  await expect(section.getByText('No se pudo consultar el historial de ejecuciones.', { exact: true })).toBeVisible();
  historyFail = false;
  await section.getByRole('button', { name: 'Reintentar reporte', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(6);
  reportForbidden = true;
  await section.getByRole('button', { name: 'Actualizar reporte', exact: true }).click();
  await expect(section.getByText('No tienes permiso para consultar este historial o tu plan no lo permite.', { exact: true })).toBeVisible();
  reportForbidden = false;
  const saved = reportRuns.splice(0, reportRuns.length, firstCanceled, secondCanceled);
  await section.getByRole('button', { name: 'Reintentar reporte', exact: true }).click();
  await expect(section.getByRole('heading', { name: 'Aún no hay ejecuciones registradas', exact: true })).toBeVisible();
  await page.getByText('Exportar resultados', { exact: true }).click();
  await expect(jsonButton).toBeDisabled();
  await expect(page.getByRole('link', { name: /Abrir reporte consolidado/ })).toHaveCount(0);
  reportRuns.splice(0, reportRuns.length, ...saved); reportMode = false;
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  console.log('PASS reporte: métricas y denominadores, duración cero/ausente, selector/filtros, error seguro, trazas autorizadas, JUnit XML válido, JSON sin claves privadas, matriz/cronología, móvil, permisos y reintentos. API simulada.');
}

async function verifyQuality(page, screenshots) {
  qualityMode = true;
  const initialQueues = queuedRequests.length;
  const initialAudits = auditPosts;
  await page.getByRole('tab', { name: 'Calidad', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Calidad del proyecto', exact: true });
  const preparation = panel.getByRole('region', { name: 'Índice de Preparación para Automatización (IPA)', exact: true });
  const health = panel.getByRole('region', { name: 'Índice Compuesto de Salud del Producto (ICSP)', exact: true });
  const refresh = panel.getByRole('button', { name: 'Actualizar evaluación', exact: true });
  await expect(preparation.getByRole('img', { name: 'IPA: 82 de 100', exact: true })).toBeVisible();
  await expect(health.getByRole('img', { name: 'ICSP: 88 de 100', exact: true })).toBeVisible();
  await expect(preparation.getByText('7 requisitos verificables · 2 ambiguos o pendientes.', { exact: true })).toBeVisible();
  await expect(preparation.locator('.quality-document-counts dd')).toHaveText(['1', '3', '2', '1']);
  await health.getByText('Escenarios inestables (1)', { exact: true }).click();
  await expect(health.getByText('Tiene resultados distintos en la ventana.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Histórico IPA', exact: true }).locator('li strong')).toHaveText(['82', '0']);
  const audits = panel.getByRole('region', { name: 'Auditorías Lighthouse registradas', exact: true });
  await expect(audits.locator('.quality-audit-values strong')).toHaveText(['94/100', '0/100', '90/100', '88/100']);
  await expect(audits.getByText(/TBT: 0 ms · CLS: 0/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Configurar auditoría', exact: true })).toHaveAttribute('href', `/projects/${projectId}/performance`);
  await page.setViewportSize({ width: 1170, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(screenshots, 'project-quality-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.getByText('Exportar informe', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar informe JSON', exact: true }).click();
  const file = await downloadPromise;
  assert.equal(file.suggestedFilename(), 'autoqa-informe-calidad.json');
  const text = await readFile(await file.path(), 'utf8');
  const exported = JSON.parse(text);
  assert.equal(exported.project.id, projectId); assert.equal(exported.ipa.score, 82); assert.equal(exported.icsp.score, 88);
  assert.ok(!text.includes('synthetic-private')); assert.ok(!text.includes('secretReference'));
  await page.evaluate(() => { window.print = () => { window.autoqaPrinted = true; }; });
  await page.getByRole('button', { name: 'Imprimir / Guardar como PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.autoqaPrinted)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-nav')).toBeHidden();
  await expect(page.locator('.project-tabs')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.getByText('Exportar informe', { exact: true }).click();
  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    const before = await page.locator('.app-shell-body').boundingBox();
    const title = await page.getByRole('heading', { name: project.name, exact: true }).evaluate(element => ({ font: getComputedStyle(element).fontSize, x: element.getBoundingClientRect().x }));
    await page.getByRole('tab', { name: 'Calidad', exact: true }).click();
    await expect(health.getByRole('img', { name: 'ICSP: 88 de 100', exact: true })).toBeVisible();
    const after = await page.locator('.app-shell-body').boundingBox();
    assert.equal(before.x, after.x); assert.equal(before.width, after.width);
    assert.deepEqual(await page.getByRole('heading', { name: project.name, exact: true }).evaluate(element => ({ font: getComputedStyle(element).fontSize, x: element.getBoundingClientRect().x })), title);
    assert.equal(await page.locator('.quality-heading-slot .project-heading').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Calidad sin desbordamiento a ${width}px.`);
    if (width === 390) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(screenshots, 'project-quality-mobile.png'), fullPage: true, animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  ipaFail = true;
  await refresh.click();
  await expect(preparation.getByText('No se pudo consultar esta evaluación.', { exact: true })).toBeVisible();
  await expect(health.getByRole('img', { name: 'ICSP: 88 de 100', exact: true })).toBeVisible();
  ipaFail = false;
  await preparation.getByRole('button', { name: 'Reintentar IPA', exact: true }).click();
  await expect(preparation.getByRole('img', { name: 'IPA: 82 de 100', exact: true })).toBeVisible();
  qualityIcspFail = true;
  await refresh.click();
  await expect(health.getByText('No se pudo consultar esta evaluación.', { exact: true })).toBeVisible();
  await expect(preparation.getByRole('img', { name: 'IPA: 82 de 100', exact: true })).toBeVisible();
  qualityIcspFail = false; qualityMalformed = true;
  await health.getByRole('button', { name: 'Reintentar ICSP', exact: true }).click();
  await expect(health.getByText('La API no devolvió una evaluación válida.', { exact: true })).toBeVisible();
  qualityMalformed = false; qualityNoResults = true;
  await health.getByRole('button', { name: 'Reintentar ICSP', exact: true }).click();
  await expect(health.getByRole('img', { name: 'ICSP: sin evaluación', exact: true })).toBeVisible();
  await expect(health.getByText('Sin resultados de ejecución', { exact: true })).toBeVisible();
  await expect(health.locator('.quality-dimensions li > div > span').filter({ hasText: 'Sin datos' })).toHaveCount(4);
  assert.ok((await health.locator('.quality-progress > span').evaluateAll(elements => elements.map(element => element.style.width))).every(width => width === '0%'));
  qualityNoResults = false; qualityAuditForbidden = true; qualityEmptyHistory = true;
  await refresh.click();
  await expect(audits.getByText('Consulta no autorizada o no incluida en el plan.', { exact: true })).toBeVisible();
  await expect(panel.getByText('Sin evaluaciones guardadas.', { exact: true })).toHaveCount(2);
  await expect(health.getByRole('img', { name: 'ICSP: 88 de 100', exact: true })).toBeVisible();
  qualityAuditForbidden = false; qualityEmptyHistory = false;
  await refresh.click();
  await expect(audits.locator('.quality-audit-values strong')).toHaveCount(4);
  qualityExportFail = true;
  await page.getByText('Exportar informe', { exact: true }).click();
  await page.getByRole('button', { name: 'Descargar informe JSON', exact: true }).click();
  await expect(panel.getByText('No se pudo exportar el informe de calidad.', { exact: true })).toBeVisible();
  await page.getByText('Exportar informe', { exact: true }).click();
  qualityExportFail = false; qualityMode = false;
  assert.equal(queuedRequests.length, initialQueues, 'Calidad no encola pruebas.');
  assert.equal(auditPosts, initialAudits, 'Consultar, actualizar y exportar Calidad no inicia auditorías.');
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  console.log('PASS calidad: IPA/ICSP y fuentes, ceros y ausencia de resultados, histórico, auditorías registradas, exportación JSON, impresión, permisos/errores independientes, geometría común y móvil. Sin auditorías ni ejecuciones automáticas. API simulada.');
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
    await verifyScenarioPagination(page);
    await verifyScenarioPagination(page, true);
    await verifySavedAutomationAfterReload(page);
    await verifyAutomationToolbar(page);
    await verifyWritableExecution(page);
    await verifySuiteProgress(page);
    await verifyAutomationRunStatus(page);
    await verifyStopSuiteDuringSubmission(page);
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
    await verifyAutomation(page, screenshots);
    await verifyManualScenario(page);
    await verifyRunReport(page, screenshots);
    await verifyQuality(page, screenshots);
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

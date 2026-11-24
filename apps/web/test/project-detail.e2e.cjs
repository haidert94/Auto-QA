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
  subscription: { status: 'ACTIVE', checkoutPrepared: false, plan: { name: 'Pro', capabilities: [
    { code: 'BROWSER_TESTS', availability: 'BETA' },
    { code: 'AI_FAILURE_EXPLANATION', availability: 'BETA' },
  ] } },
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
  createdAt: '2026-11-17T12:00:00Z', updatedAt: '2026-11-18T12:30:00Z',
  description: 'Validación de transacciones, contratos API y flujos de checkout en un entorno autorizado.',
  priorityModules: ['Checkout', 'Contratos API'], missingRequirements: [],
  environments: [environment, { ...environment, id: '10000000-0000-4000-8000-000000000003', type: 'QA', baseUrl: 'https://qa.example.test/', authorizationConfirmed: false, hasCredentials: false }],
  roles: [{ name: 'Tester QA', description: 'Validación del checkout sandbox.', secretReference: 'vault:synthetic-private-reference',
    permissions: [{ resource: 'checkout', action: 'read', allowed: true }, { resource: 'payments', action: 'delete', allowed: false }] }],
  executionSettings: { browser: 'CHROMIUM', maxPages: 10 },
};
let projectRegistrations = null;
let documents = ['PROCESSED', 'UPLOADED', 'VALIDATED', 'DECLARED'].map((state, i) => ({
  id: `20000000-0000-4000-8000-00000000000${i}`, filename: ['spec-checkout.yaml', 'requisitos-pagos.pdf', 'flujos-criticos.md', 'contrato-declarado.txt'][i],
  type: i === 0 ? 'API' : 'REQUIREMENTS', state, classificationSource: 'MANUAL', versions: [],
  testTypes: [], testTypesSource: 'PENDING',
  currentVersion: state === 'DECLARED' ? null : { id: String(i), number: 1, format: ['yaml', 'pdf', 'md'][i], size: 2048, hasText: state !== 'UPLOADED' },
}));
const ipa = { score: 82, status: 'ASSESSED', signals: [
  { criterion: 'Autorización y alcance', weight: 30, points: 30, missing: [], blocking: true },
  { criterion: 'Documentación y requisitos', weight: 40, points: 22, missing: ['Confirmar requisitos ambiguos.'], blocking: false },
  { criterion: 'Roles y credenciales', weight: 30, points: 30, missing: [], blocking: false },
] };
const loadRequests = [];
const generationRequests = [];
const generationJobId = '60400000-0000-4000-8000-000000000001';
let generationSelectionBlocked = false;
const qualityExecutionRequests = new Map();
let qualityScenarioRows = [];
const qualityFileRequests = [];
let qualityWaitForPeers = null;
let qualityReviewKind = null;
let generationErrorCode = null;
let generationTotal = 1;
const completedDocumentTypes = new Set();
const pendingFinding = {
  id: 'aadd4574-f8ec-4fa7-aaaa-abc28d39b319', kind: 'USER_STORY', text: 'Como comprador quiero descargar el comprobante.',
  pendingConfirmation: true, pendingReason: 'Falta definir el formato del comprobante.',
  source: { filename: 'requisitos-pagos.pdf', version: 1, locator: 'página 2' }, relatedSource: null,
};
let clarification = null;
let documentIpaOverride = null;
let docsFail = false;
let ipaFail = false;
let ipaTraceabilityBlocked = false;
let checkScenarioTraceability = false;
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
  { id: scenarioB, caseCode: 'TC-PAG-002', title: 'Rechazo por fondos insuficientes con callback asíncrono', requirementId: requirement.id,
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
const reportExplanationRequests = [];
let reportRepairRequests = 0;
const reportFrameRepair = { step: 3, frames: ['iframe[id="checkout"]'] };
const reportExplanation = 'Descripción\nEl navegador no recibió la confirmación.\n\nPosible solución\nComprueba la respuesta del servicio de checkout.';
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
  await expect(dialog.getByRole('button', { name: 'Ver reporte', exact: true })).toBeEnabled({ timeout: 10000 });
}

async function openSuiteReport(page, dialog) {
  await dialog.getByRole('button', { name: 'Ver reporte', exact: true }).click();
  await expect(dialog).toBeHidden();
  const reportTab = page.getByRole('tab', { name: 'Reportes', exact: true });
  await expect(reportTab).toHaveAttribute('aria-selected', 'true');
  await expect(reportTab).toBeFocused();
  await expect(page).toHaveURL(/#reporte$/);
  await expect(page.getByRole('table', { name: 'Ejecuciones registradas', exact: true })).toBeVisible();
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
  if (path === '/api/projects' && request.method === 'GET') return send([project]);
  if (path === '/api/projects' && request.method === 'POST' && projectRegistrations) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    projectRegistrations.push(payload);
    project = {
      ...project, ...payload, revision: 1, roles: [],
      environments: payload.environments.map(item => ({ ...item, id: environment.id })),
    };
    return send(project, 201);
  }
  const base = `/api/projects/${projectId}`;
  if (path === base + '/automation/types/pending') {
    const assigned = new Set(documents.flatMap(doc => doc.testTypes ?? []));
    const codes = ['functional_web', 'ux', 'performance', 'manual'].filter(code =>
      assigned.has(code) && !completedDocumentTypes.has(code));
    return send({
      types: codes.map(code => ({ code, available: !generationSelectionBlocked || code !== 'manual' })),
      hasAssignedDocuments: assigned.size > 0, hasCurrentAnalysis: true, hasUnverifiedTypes: false,
      verifiable: codes.includes('performance') ? 1 : 4,
      ambiguous: codes.includes('performance') ? 0 : 1,
    });
  }
  if (path === base + '/automation/types/available') {
    const assigned = new Set(documents.flatMap(doc => doc.testTypes ?? []));
    return send(['functional_web', 'ux', 'manual'].map(code => ({
      code, available: !generationSelectionBlocked || code !== 'manual', selectedInDocuments: assigned.has(code),
    })));
  }
  if (path === base + '/automation/' + generationJobId && request.method === 'GET') {
    if (generationErrorCode === 'generation-incomplete') return send({
      id: generationJobId, status: 'FAILED', stage: 'generating', errorCode: generationErrorCode,
      result: { generation: { totalCreated: 0, outcomes: [
        { type: 'performance', created: 0, usedFallback: false },
        { type: 'ux', created: 0, usedFallback: false, issue: 'no-cases' },
      ] } },
    });
    if (generationErrorCode) return send({
      id: generationJobId, status: 'FAILED', stage: 'generating', errorCode: generationErrorCode,
    });
    const types = generationRequests.at(-1)?.types;
    if (!types) return send({ id: generationJobId, status: 'COMPLETED', stage: 'review-ready' });
    return send({ id: generationJobId, status: 'COMPLETED', stage: 'generated', result: {
      generation: { totalCreated: generationTotal * types.length, outcomes: types.map(type => ({
        type, created: generationTotal, usedFallback: generationTotal === 0,
        issue: generationTotal === 0 ? 'ai-budget-exhausted' : undefined,
      })) },
    } });
  }
  if (request.method === 'POST' && (path === base + '/automation' || path === base + '/automation/' + generationJobId + '/select')) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    generationRequests.push(JSON.parse(Buffer.concat(chunks).toString()));
    return send({ id: generationJobId, status: 'QUEUED', stage: 'pending' }, 201);
  }
  if (path === base + '/scenarios/quality') return send(qualityScenarioRows);
  if (path === base + '/report/quality') return send(qualityScenarioRows.map(row => ({
    id: row.quality.resourceId, kind: row.quality.kind, title: row.title,
    target: row.quality.executionConfig.url, recordedAt: '2026-11-23T13:00:00.000Z',
    status: row.quality.kind === 'availability' ? 'available' : 'completed', hasEvidence: true, error: null,
    metrics: [{ label: 'Resultado registrado', value: row.quality.result }],
  })));
  if (path.startsWith(base + '/report/quality/availability/')) return send([{
    id: 'fixture-check', at: '2026-11-23T13:00:00.000Z', status: 'UP', httpStatus: 204, latencyMs: 0, error: null,
  }]);
  if (path.startsWith(base + '/report/quality/ux/')) return send({
    summary: 'Resumen UX de prueba', findings: [{ severity: 'major', summary: 'Campo sin etiqueta', recommendation: 'Añadir etiqueta' }],
    hasScreenshot: true,
  });
  const configuration = qualityScenarioRows.find(row => path === base + '/scenarios/quality/'
    + row.quality.kind + '/' + row.quality.resourceId + '/configuration');
  if (configuration && request.method === 'PATCH') {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { environmentId, url, intervalMinutes, timeoutMs, active, method, minStatus, maxStatus, stages } = JSON.parse(Buffer.concat(chunks).toString());
    if (environmentId !== environment.id || (url && !url.startsWith('https://example.test/'))) {
      return send({ message: 'La URL de la prueba está fuera del alcance autorizado.' }, 400);
    }
    const config = configuration.quality.executionConfig;
    config.environmentId = environmentId;
    if (url) config.url = url;
    if (configuration.quality.kind === 'availability') {
      config.monitor = { intervalMinutes, timeoutMs, active, method, minStatus, maxStatus };
      config.parameters = [
        { label: 'Comprobación', value: 'HTTP ' + method + ' · códigos ' + minStatus + ' a ' + maxStatus },
        { label: 'Intervalo del monitor', value: intervalMinutes + ' min' },
        { label: 'Tiempo máximo de respuesta', value: timeoutMs + ' ms' },
        { label: 'Estado del monitor', value: active ? 'Activo' : 'En pausa' },
      ];
    }
    if (configuration.quality.kind === 'load') {
      config.stages = stages;
      config.parameters = stages.map(({ duration, target }, index) => ({
        label: 'Etapa ' + (index + 1), value: duration + ' · ' + target + ' usuarios virtuales',
      }));
    }
    return send(configuration);
  }
  const execution = path.match(/\/scenarios\/quality\/([^/]+)\/([^/]+)\/executions\/([^/]+)$/);
  if (execution) {
    const [, kind, resourceId, id] = execution;
    if (request.method === 'POST') {
      const row = qualityScenarioRows.find(item => item.quality.kind === kind && item.quality.resourceId === resourceId);
      if (!row?.quality.automation.prepared || !row.quality.executionConfig.environmentId) return send({ message: 'Prueba pendiente.' }, 400);
      qualityExecutionRequests.set(id, kind);
      return send({ id, status: 'QUEUED' }, 201);
    }
    if (!qualityExecutionRequests.has(id)) return send({ message: 'Ejecución no encontrada.' }, 404);
    return send({ id, status: 'COMPLETED', passed: kind === 'availability' });
  }
  const qualityFile = qualityScenarioRows.find(row => path === base + '/scenarios/quality/'
    + row.quality.kind + '/' + row.quality.resourceId + '/automation');
  if (qualityFile) {
    const { kind, automation } = qualityFile.quality;
    qualityFileRequests.push({ kind, method: request.method });
    if (request.method === 'POST') {
      await qualityWaitForPeers?.(kind);
      automation.prepared = kind !== qualityReviewKind;
      automation.reviewReason = automation.prepared ? undefined : 'Configura un perfil de carga válido.';
      return send(automation);
    }
    if (!automation.prepared) return send({ message: 'Generación pendiente' }, 404);
    return send({ ...automation, code: '// Archivo preparado para ' + automation.tool });
  }
  if (path === base + '/scenarios/requirements') return send([requirement]);
  if (path === base + '/scenarios/insights') {
    return send({ scenarios: scenarios.length, steps: 0, duplicateGroups: 0, duplicatedSteps: 0, groups: [] });
  }
  if (path === base + '/scenarios/delete-selected' && request.method === 'POST') {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { scenarioIds } = JSON.parse(Buffer.concat(chunks).toString());
    if (!Array.isArray(scenarioIds) || !scenarioIds.length) return send({ message: 'Selecciona escenarios.' }, 400);
    const previousCount = scenarios.length;
    scenarios = scenarios.filter(scenario => !scenarioIds.includes(scenario.id));
    scenarioRuns = scenarioRuns.filter(run => !scenarioIds.includes(run.scenarioId));
    return send({ deleted: previousCount - scenarios.length });
  }
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
    if (scenario && scenarioPath === scenario.id && request.method === 'GET') return send(scenario);
    if (scenario && scenarioPath === scenario.id && request.method === 'PATCH') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      Object.assign(scenario, JSON.parse(Buffer.concat(chunks).toString()));
      scenario.requirement = scenario.requirementId === requirement.id ? requirement : null;
      return send(scenario);
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
    const queuedAges = activityRuns.filter(run => run.status === 'QUEUED').map(run => Math.floor((Date.now() - Date.parse(run.createdAt)) / 1000));
    return send({
      oldestQueuedSeconds: Math.max(0, ...queuedAges),
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
    if (reportForbidden) return send({ message: 'Sin permisos' }, 403);
    if (historyFail) return send({ message: 'Historial no disponible' }, 503);
    const view = requestUrl.searchParams.get('view');
    if (view !== 'overview' && view !== 'report') return send(runs);
    const recent = runs.filter(run => run.status !== 'CANCELED').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (view === 'report') return send(recent.slice(0, 100));
    const latest = new Map();
    for (const run of recent) {
      if (run.scenarioId && !latest.has(run.scenarioId)) latest.set(run.scenarioId, run);
    }
    return send({ latest: [...latest.values()], history: recent.slice(0, 100) });
  }
  if (request.method === 'POST' && path === `${base}/runs/${reportRuns[1].id}/explain`) {
    reportExplanationRequests.push(requestUrl.searchParams.get('resultId'));
    return send(reportExplanationRequests.length === 1
      ? { usedFallback: true, text: 'El servicio temporalmente no está disponible.' }
      : { usedFallback: false, text: reportExplanation });
  }
  const failedEvidencePath = `${base}/runs/${reportRuns[1].id}/results/${reportRuns[1].results[0].id}`;
  if (request.method === 'GET' && path === failedEvidencePath + '/evidence') {
    return send({ status: 'FAILED', trace: null, video: null, screenshots: [], frameRepair: reportFrameRepair });
  }
  if (request.method === 'POST' && path === failedEvidencePath + '/apply-solution') {
    reportRepairRequests++;
    return send({ scenarioId: reportRuns[1].scenarioId, automationId: 'synthetic-repair' });
  }
  const evidenceBase = `${base}/runs/${reportRuns[0].id}/results/${reportRuns[0].results[0].id}`;
  if (path === evidenceBase + '/evidence') return send({
    status: 'PASSED', trace: 'a'.repeat(32), video: 'b'.repeat(32),
    screenshots: [{ step: 1, action: 'Confirmación visible', key: 'c'.repeat(32), status: 'pass' }],
  });
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
  if (path === base + '/ipa') {
    if (ipaFail) return send({ message: 'IPA no disponible' }, 503);
    if (ipaTraceabilityBlocked) return send({ ipa: { ...ipa, score: 69, status: 'BLOCKED',
      blockers: ['Vincula criterios de aceptación explícitos con sus requisitos.'] } });
    if (checkScenarioTraceability && !scenarios[0].requirementId) return send({ ipa: { ...ipa, score: 69, status: 'BLOCKED',
      blockers: ['Asocia todos los escenarios activos a una historia de usuario o requisito.'] } });
    const newDocument = documents.find(document => document.filename === 'requisitos-demo.md');
    const points = newDocument?.state === 'VALIDATED' ? 40 : newDocument?.state === 'PROCESSED' ? 36 : newDocument ? 28 : 22;
    const current = {
      ...ipa, score: ipa.score + points - 22,
      signals: ipa.signals.map(signal => signal.criterion === 'Documentación y requisitos' ? { ...signal, points } : signal),
    };
    return send({ ipa: qualityMode ? { ...current,
      documents: { declared: 1, uploaded: 3, processed: 2, validated: 1 }, verifiable: 7, ambiguous: 2, blockers: [], hints: ['Revisa el timeout.'] } : current,
      generatedAt: '2026-11-18T12:00:00Z' });
  }
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
  if (path === base + '/load-tests') {
    if (request.method === 'GET') return send([]);
    if (request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      loadRequests.push(JSON.parse(Buffer.concat(chunks).toString()));
      return send({ id: randomUUID(), status: 'QUEUED' }, 201);
    }
  }
  if (path === base + '/documents' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers['content-type'] } }).formData();
    const file = form.get('files');
    const provided = form.get('testTypes');
    const testTypes = provided ? JSON.parse(provided) : file.name === 'requisitos-demo.md' ? ['functional_web'] : [];
    const testTypesSource = provided ? 'MANUAL' : 'AUTOMATIC';
    const version = { id: randomUUID(), number: 1, format: 'MD', size: file.size, hasText: false };
    const document = { id: randomUUID(), filename: file.name, type: 'OTHER', state: 'UPLOADED',
      classificationSource: 'PENDING', testTypes, testTypesSource, currentVersion: version, versions: [version] };
    documents.push(document);
    return send([document], 201);
  }
  if (path.startsWith(base + '/documents/') && path.endsWith('/validation') && request.method === 'PATCH') {
    const document = documents.find(item => item.id === path.split('/').at(-2));
    if (!document) return send({ message: 'Documento no encontrado.' }, 404);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const { validated } = JSON.parse(Buffer.concat(chunks).toString());
    const reviewed = { ...document, state: validated ? 'VALIDATED' : 'PROCESSED' };
    documents = documents.map(item => item.id === reviewed.id ? reviewed : item);
    return send(reviewed);
  }
  if (path.startsWith(base + '/documents/') && path.endsWith('/test-types') && ['PATCH', 'POST'].includes(request.method)) {
    const document = documents.find(document => document.id === path.split('/').at(-2));
    if (!document) return send({ message: 'Documento no encontrado.' }, 404);
    if (request.method === 'POST') {
      if (document.testTypesSource === 'MANUAL') return send(document);
      const testTypes = document.testTypesSource === 'AUTOMATIC' ? ['compatibility', 'availability'] : ['compatibility'];
      const reviewed = { ...document, testTypes, testTypesSource: 'AUTOMATIC' };
      documents = documents.map(item => item.id === document.id ? reviewed : item);
      return send(reviewed);
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    document.testTypes = JSON.parse(Buffer.concat(chunks).toString()).testTypes;
    document.testTypesSource = 'MANUAL';
    return send(document);
  }
  if (path === base + '/documents') return docsFail ? send({ message: 'Documentos temporalmente no disponibles.' }, 503) : send(documents);
  const documentReport = () => ({
    analysis: { warnings: [], findings: [{
      ...pendingFinding, pendingConfirmation: !clarification, clarification,
    }] },
    ipa: { ...ipa, verifiable: clarification ? 5 : 4, ambiguous: clarification ? 0 : 1,
      documents: { declared: 1, uploaded: 3, processed: 2, validated: 1 }, signals: [], recommendations: [], ...documentIpaOverride },
  });
  if (path === base + '/documents/analysis/' + pendingFinding.id + '/clarification' && request.method === 'PATCH') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    clarification = JSON.parse(Buffer.concat(chunks).toString());
    return send({ affectedScenarios: [{ id: scenarios[0].id, title: scenarios[0].title }], report: documentReport() });
  }
  if (path === base + '/documents/analysis') return send(documentReport());
  if (path === base + '/documents/analyze' && request.method === 'POST') {
    documents = documents.map(document => document.filename === 'requisitos-demo.md' && document.state === 'UPLOADED'
      ? { ...document, state: 'PROCESSED', currentVersion: { ...document.currentVersion, hasText: true } }
      : document);
    return send(documentReport());
  }
  if (path.startsWith(base + '/')) return send([]);
  return send({ message: 'No encontrado' }, 404);
});

async function verifyUnifiedOnboarding(page, website) {
  const originalProject = project;
  const originalRole = account.role;
  projectRegistrations = [];
  const next = page.getByRole('button', { name: 'Siguiente', exact: true });
  try {
    await page.goto(website + '/projects/new');
    await expect(page).toHaveURL(website + '/onboarding');
    await expect(page.getByRole('heading', { name: 'Bienvenido a AutoQA' })).toBeVisible();
    await page.getByRole('link', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(website + '/projects');
    const registerInProjects = page.getByRole('link', { name: 'Registrar aplicación', exact: true });
    await expect(registerInProjects).toHaveAttribute('href', '/onboarding');
    await registerInProjects.click();
    await next.click();
    const draft = page.getByRole('button', { name: 'Guardar borrador', exact: true });
    await expect(draft).toBeDisabled();
    await page.getByLabel('Nombre de la aplicación').fill('Registro en borrador');
    await next.click();
    await expect(next).toBeDisabled();
    await draft.click();
    await expect(page).toHaveURL(website + '/projects/' + projectId + '#datos');
    assert.equal(projectRegistrations[0].status, 'DRAFT');
    assert.equal(projectRegistrations[0].environments[0].authorizationConfirmed, false);
    assert.equal(projectRegistrations[0].environments[0].baseUrl, undefined);
    await expect(page.getByLabel('Módulos prioritarios, uno por línea')).toBeVisible();

    await page.goto(website + '/dashboard');
    const registerInDashboard = page.getByRole('link', { name: 'Registrar aplicación', exact: true });
    await expect(registerInDashboard).toHaveAttribute('href', '/onboarding');
    await registerInDashboard.click();
    await expect(page).toHaveURL(website + '/onboarding');
    await next.click();
    await page.getByLabel('Nombre de la aplicación').fill('Registro completo');
    await next.click();
    await page.getByLabel('URL base').fill('https://qa.example.test/');
    await page.getByLabel('Modo de acceso').selectOption('PUBLIC');
    await next.click();
    await expect(next).toBeDisabled();
    await page.getByRole('checkbox', { name: /^Confirmo que soy dueño/ }).check();
    await next.click();
    await expect(page.getByRole('heading', { name: 'Revisa y crea' })).toBeVisible();
    assert.equal(projectRegistrations.length, 1);
    await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
    await expect(page).toHaveURL(website + '/projects/' + projectId + '#datos');
    assert.equal(projectRegistrations.length, 2);
    assert.equal(projectRegistrations[1].status, 'READY');
    assert.equal(projectRegistrations[1].environments[0].authorizationConfirmed, true);
    assert.deepEqual(projectRegistrations[1].environments[0].allowedHosts, ['qa.example.test']);
    await page.getByRole('button', { name: 'Editar configuración del proyecto' }).click();
    await expect(page.getByLabel('Módulos prioritarios, uno por línea')).toBeVisible();
    await expect(page.getByText('Preferencias de ejecución y notificaciones', { exact: true })).toBeVisible();

    account.role = 'VIEWER';
    await page.goto(website + '/onboarding');
    await expect(page).toHaveURL(website + '/projects');
    await expect(page.getByRole('link', { name: /Registrar aplicación/ })).toHaveCount(0);
    console.log('PASS Registro guiado desde Resumen y Proyectos, borrador, autorización y permisos.');
  } finally {
    project = originalProject;
    account.role = originalRole;
    projectRegistrations = null;
    await page.goto(website + '/projects/' + projectId);
  }
}

async function verifyPostmanLoadImport(page, website) {
  const original = project;
  project = { ...project, environments: project.environments.map(env => ({ ...env, authorizationConfirmed: true })) };
  const url = page.getByLabel('URL a cargar', { exact: true });
  const input = page.getByLabel('Colección JSON', { exact: true });
  const fixture = {
    info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      { request: { method: 'GET', url: 'https://source.example.test/api/status?token=synthetic' } },
      { request: { method: 'POST', url: '{{baseUrl}}/api/products' } },
      { request: { method: 'GET', url: '{{baseUrl}}/api/products/:id' } },
      { request: { method: 'GET', url: '//other.example.test/hidden' } },
      { item: [{ request: { method: 'GET', url: { raw: '{{baseUrl}}/v1/products' } } }] },
      { auth: { type: 'bearer' }, item: [{ request: { method: 'GET', url: '/private' } }] },
    ],
  };
  const originalRequests = loadRequests.length;
  try {
    await page.goto(website + "/projects/" + projectId + "/load");
    await input.setInputFiles({ name: 'collection.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await expect(page.getByRole('alert').getByText('El archivo no contiene JSON válido.')).toBeVisible();
    await input.setInputFiles({ name: 'collection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    const endpoints = page.getByRole('combobox', { name: 'Endpoint GET', exact: true });
    await expect(endpoints.locator('option')).toHaveCount(3);
    await expect(page.getByText('Solicitudes con otros métodos: 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Solicitudes que requieren autenticación: 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Solicitudes con rutas pendientes de completar: 2', { exact: true })).toBeVisible();
    await endpoints.selectOption({ label: 'GET · Raíz /api/status' });
    await expect(url).toHaveValue('https://staging.example.test/api/status');
    await expect(page.getByText('Agrega en la URL los parámetros de prueba que correspondan.')).toBeVisible();
    await endpoints.selectOption({ label: 'GET · Entorno /v1/products' });
    await expect(url).toHaveValue('https://staging.example.test/checkout/v1/products');
    await page.getByRole('combobox', { name: 'Entorno', exact: true }).selectOption(project.environments[1].id);
    await expect(url).toHaveValue('https://qa.example.test/v1/products');
    assert.equal(loadRequests.length, originalRequests, 'Importar, elegir endpoint y cambiar entorno no encolan carga.');
    await page.getByLabel('Nombre', { exact: true }).fill('Catálogo API');
    await page.getByRole('button', { name: 'Encolar prueba', exact: true }).click();
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('');
    assert.equal(loadRequests.length, originalRequests + 1);
    assert.equal(loadRequests.at(-1).url, 'https://qa.example.test/v1/products');
    assert.equal(loadRequests.at(-1).environmentId, project.environments[1].id);
    console.log('PASS importa Postman, usa el entorno autorizado y conserva el envío explícito de k6.');
  } finally {
    project = original;
  }
  await page.goto(website + "/projects/" + projectId);
}

async function verifyDocumentGenerationConfirmation(page) {
  const original = structuredClone(documents);
  const initialRequests = generationRequests.length;
  const originalScenarios = [...scenarios];
  const scenariosTab = page.getByRole('tab', { name: /^Escenarios/ });
  const generate = page.getByRole('button', { name: 'Generar casos de prueba', exact: true });
  const modal = page.getByRole('dialog', { name: 'Confirmar generación de casos' });
  const confirm = modal.getByRole('button', { name: 'Confirmar generación', exact: true });
  const cancel = modal.getByRole('button', { name: 'Cancelar', exact: true });
  try {
    ipaTraceabilityBlocked = true;
    await scenariosTab.click();
    await expect(generate).toBeDisabled();
    await expect(page.getByText('Vincula criterios de aceptación explícitos con sus requisitos.', { exact: true })).toBeVisible();
    ipaTraceabilityBlocked = false;
    checkScenarioTraceability = true;
    const firstScenario = scenarios[0];
    Object.assign(firstScenario, { requirementId: null, requirement: null });
    await page.reload();
    await scenariosTab.click();
    await expect(page.getByText('Asocia todos los escenarios activos a una historia de usuario o requisito.', { exact: true })).toBeVisible();
    await expect(generate).toBeDisabled();
    await page.getByRole('button', { name: 'Editar escenario', exact: true }).click();
    const story = page.getByRole('combobox', { name: 'Historia o requisito asociado', exact: true });
    await expect(story).toHaveValue('');
    await story.selectOption(requirement.id);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(story).toBeHidden();
    await expect(page.getByText('RF-01 / Checkout sandbox', { exact: true }).first()).toBeVisible();
    await expect(generate).toBeEnabled();
    assert.equal(firstScenario.requirementId, requirement.id);
    await generate.click();
    await expect(modal.getByText(/marca al menos un tipo/)).toBeVisible();
    await expect(confirm).toBeDisabled();
    await cancel.click();
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await expect(page.getByRole('heading', { name: '02 // Historias de usuario y Documentos asociados', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Adjuntar nuevo documento o especificación' }).click();
    const documentsDialog = page.getByRole('dialog', { name: 'Historias de usuario y Documentos asociados', exact: true });
    const doc = documentsDialog.locator('ul.document-list--saved > li').filter({ hasText: 'requisitos-pagos.pdf' });
    await doc.getByText('Aplica a: General', { exact: true }).click();
    await doc.getByRole('checkbox', { name: 'Funcional web', exact: true }).click();
    await expect(doc.getByRole('checkbox', { name: 'Funcional web', exact: true })).toBeChecked();
    await doc.getByRole('checkbox', { name: 'Casos manuales', exact: true }).click();
    await expect(doc.getByRole('checkbox', { name: 'Casos manuales', exact: true })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(documentsDialog).toBeHidden();
    await scenariosTab.click();
    generationSelectionBlocked = true;
    await generate.click();
    await expect(modal.getByText('Fuera de tu plan', { exact: false })).toBeVisible();
    await expect(confirm).toBeDisabled();
    await cancel.click();
    generationSelectionBlocked = false;
    await generate.click();
    await expect(modal.getByRole('listitem')).toHaveText(['Funcional web', 'Casos manuales']);
    await expect(modal.getByText(/4 requisitos verificables · 1 pendiente/)).toBeVisible();
    assert.equal(generationRequests.length, initialRequests, 'Abrir o cancelar no genera casos.');
    const addedScenarios = ['Escenario web generado', 'Escenario manual generado'].map((title, index) => ({
      ...scenarios[0], id: randomUUID(), title, tags: index === 1 ? ['@manual'] : ['@funcional'],
    }));
    scenarios.push(...addedScenarios);
    await confirm.click();
    await expect(page.getByText('Se guardaron 2 escenarios.', { exact: true })).toBeVisible();
    for (const addedScenario of addedScenarios) {
      await expect(page.getByRole('button', { name: addedScenario.title, exact: true })).toBeVisible();
    }
    const expected = ['functional_web', 'manual'];
    assert.deepEqual(generationRequests.slice(initialRequests), [
      { url: project.environments[0].baseUrl, documentTestTypes: expected }, { types: expected },
    ]);
    expected.forEach(code => completedDocumentTypes.add(code));
    await generate.click();
    await expect(modal.getByText('La documentación marcada ya pasó por generación.')).toBeVisible();
    await expect(confirm).toBeDisabled();
    await cancel.click();
    documents.push({ ...documents[0], id: randomUUID(), filename: 'performance.md', testTypes: ['performance'] });
    await generate.click();
    await expect(modal.getByRole('listitem')).toHaveText(['Performance']);
    await expect(modal.getByText('1 requisito verificable · 0 pendientes')).toBeVisible();
    generationTotal = 0;
    await confirm.click();
    const emptyResult = page.getByRole('alert').filter({ hasText: 'No se guardó ningún escenario.' });
    await expect(emptyResult).toContainText('Performance · La cuota mensual de IA disponible es insuficiente para generar estos casos.');
    await expect(emptyResult).toContainText('Referencia de generación ' + generationJobId.slice(0, 8));
    await expect(page.getByText('Se guardaron 2 escenarios.', { exact: true })).toBeHidden();
    assert.deepEqual(generationRequests.slice(initialRequests + 2), [
      { url: project.environments[0].baseUrl, documentTestTypes: ['performance'] }, { types: ['performance'] },
    ]);
    console.log('PASS al agregar Performance solo confirma y encola el tipo pendiente.');

    generationErrorCode = 'review-missing';
    await generate.click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    const failure = page.getByRole('alert').filter({ hasText: 'Explorer no pudo usar el análisis' });
    await expect(failure).toContainText('Referencia de generación ' + generationJobId.slice(0, 8));
    console.log('PASS Escenarios indica la causa y la referencia cuando Explorer rechaza la generación.');

    documents.push({ ...documents[0], id: randomUUID(), filename: 'ux.md', testTypes: ['ux'] });
    generationErrorCode = 'generation-incomplete';
    await generate.click();
    await expect(modal.getByRole('listitem')).toHaveText(['UX', 'Performance']);
    await confirm.click();
    const partial = page.getByRole('alert').filter({ hasText: 'No se guardó el lote' });
    await expect(partial).toContainText('UX · El agente no devolvió casos para estos requisitos.');
    await expect(partial).not.toContainText('Performance');
    await expect(page.getByRole('tab', { name: 'Escenarios (5)', exact: true })).toBeVisible();
    await generate.click();
    await expect(modal.getByRole('listitem')).toHaveText(['UX', 'Performance']);
    await cancel.click();
    console.log('PASS un lote incompleto conserva la lista y permite reintentar todos los tipos pendientes.');
  } finally {
    documents = original;
    checkScenarioTraceability = false;
    Object.assign(scenarios[0], { requirementId: requirement.id, requirement });
    generationSelectionBlocked = false;
    completedDocumentTypes.clear();
    generationErrorCode = null;
    generationTotal = 1;
    scenarios = originalScenarios;
  }
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
}

async function verifyRequirementClarification(page) {
  try {
    await page.getByRole('button', { name: /Ambiguos o pendientes/i }).click();
    await page.getByRole('button', { name: 'Ver detalle del hallazgo ' + pendingFinding.id }).click();
    const modal = page.getByRole('dialog', { name: 'Historia de usuario' });
    await expect(modal.getByText(pendingFinding.pendingReason)).toBeVisible();
    const approve = modal.getByRole('button', { name: 'Aprobar aclaración', exact: true });
    await expect(approve).toBeDisabled();
    const correctedText = 'Como comprador quiero descargar el comprobante en PDF.';
    await modal.getByLabel('Adjuntar corrección (.txt o .md)').setInputFiles({
      name: 'correccion.md', mimeType: 'text/markdown', buffer: Buffer.from(correctedText),
    });
    await expect(modal.getByLabel('Requisito aclarado')).toHaveValue(correctedText);
    const criterion = 'Al pulsar Descargar se guarda un archivo PDF.';
    await modal.getByLabel('Criterio de aceptación observable').fill(criterion);
    await approve.click();
    await expect(modal.getByText(/Aclaración aprobada/)).toBeVisible();
    await expect(modal.getByRole('link', { name: scenarios[0].title })).toBeVisible();
    assert.deepEqual(clarification, { text: correctedText, criterion, filename: 'correccion.md' });
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
    await expect(page.getByRole('button', { name: /Ambiguos o pendientes/i })).toBeDisabled();
  } finally {
    clarification = null;
  }
  console.log('PASS permite adjuntar y aprobar una aclaración, y muestra el escenario afectado.');
}

async function verifyIpaPoints(page) {
  documentIpaOverride = {
    score: 100,
    signals: [
      { criterion: 'Aplicación y autorización', weight: 15, points: 15, available: [], missing: [] },
      { criterion: 'Documentación funcional', weight: 30, points: 30, available: [], missing: [] },
      { criterion: 'Accesos y permisos', weight: 0, points: 0, available: ['No se han declarado roles.'], missing: [] },
      { criterion: 'Alcance y seguridad', weight: 15, points: 15, available: [], missing: [] },
    ],
  };
  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await page.getByText('Información disponible y faltante', { exact: true }).click();
    const section = page.locator('details.detail-analysis__section').filter({ hasText: 'Información disponible y faltante' });
    await expect(section.getByText('60 de 60 puntos aplicables', { exact: true })).toBeVisible();
    await expect(section.getByText('100 %', { exact: true })).toHaveCount(3);
    await expect(section.getByText('No aplica', { exact: true })).toBeVisible();
    await expect(section.getByText('Los criterios marcados como «No aplica» quedan fuera del cálculo del IPA.')).toBeVisible();
    console.log('PASS Datos distingue porcentajes por criterio, puntos aplicables y accesos sin roles.');
  } finally {
    documentIpaOverride = null;
    await page.reload();
  }
}

async function verifyDocumentUploads(page) {
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const ipaCard = page.locator('.detail-ipa');
  const ipaScore = ipaCard.locator('.ipa-score-value');
  const documentation = ipaCard.getByRole('listitem').filter({ hasText: 'Documentación y requisitos' });
  await expect(ipaScore).toHaveText('82');
  const original = [...documents];
  documents = documents.map(document => document.state === 'VALIDATED'
    ? { ...document, testTypes: ['functional_web', 'manual'], testTypesSource: 'AUTOMATIC' }
    : document);
  await page.getByRole('button', { name: 'Adjuntar nuevo documento o especificación' }).click();
  const dialog = page.getByRole('dialog', { name: 'Historias de usuario y Documentos asociados' });
  const uploadPanel = dialog.getByRole('region', { name: 'Carga de documentos' });
  const savedPanel = dialog.getByRole('region', { name: 'Archivos del proyecto' });
  const card = filename => savedPanel.locator('ul.document-list--saved > li').filter({ has: page.getByText(filename, { exact: true }) });
  const picker = uploadPanel.locator('input[type="file"]');
  try {
    const types = ['Funcional web', 'Mobile emulado', 'Compatibilidad', 'Disponibilidad', 'Performance', 'UX', 'Casos manuales'];
    await expect(picker).toHaveCount(1);
    await expect(picker).toBeVisible();
    await expect(picker).toBeEnabled();
    await expect(picker).toHaveAccessibleName('General');
    await expect(card('spec-checkout.yaml')).toBeVisible();
    const validated = card('flujos-criticos.md');
    await validated.getByText('Aplica a: Funcional web · Casos manuales', { exact: true }).click();
    for (const type of types) {
      await expect(validated.getByRole('checkbox', { name: type, exact: true })).toBeDisabled();
    }
    await expect(validated.getByRole('checkbox', { name: 'Funcional web', exact: true })).toBeChecked();
    await expect(validated.getByRole('checkbox', { name: 'UX', exact: true })).not.toBeChecked();
    await validated.getByRole('button', { name: 'Retirar validación', exact: true }).click();
    await expect(validated.getByRole('checkbox', { name: 'UX', exact: true })).toBeEnabled();
    await validated.getByRole('checkbox', { name: 'UX', exact: true }).click();
    await expect(validated.getByRole('checkbox', { name: 'UX', exact: true })).toBeChecked();
    await validated.getByRole('button', { name: 'Marcar como validado', exact: true }).click();
    await expect(validated.getByRole('button', { name: 'Retirar validación', exact: true })).toBeEnabled();
    await expect(picker).toBeEnabled();
    await expect(validated.getByRole('checkbox', { name: 'UX', exact: true })).toBeDisabled();
    await expect(validated.getByRole('checkbox', { name: 'UX', exact: true })).toBeChecked();
    await picker.setInputFiles({ name: 'requisitos-demo.md', mimeType: 'text/markdown', buffer: Buffer.from('RF-1: Iniciar sesión.') });
    const functional = card('requisitos-demo.md');
    await expect(functional.getByText('Clasificación por determinar')).toBeVisible();
    await functional.getByText('Aplica a: Funcional web').click();
    await expect(functional.getByText(/Sugerencia automática/)).toBeVisible();
    for (const type of types) {
      await expect(functional.getByRole('checkbox', { name: type, exact: true })).toBeVisible();
    }
    await expect(functional.getByRole('checkbox', { name: 'Funcional web', exact: true })).toBeChecked();
    await expect(functional.getByRole('checkbox', { name: 'UX', exact: true })).not.toBeChecked();
    await functional.getByRole('checkbox', { name: 'UX', exact: true }).click();
    await expect(functional.getByText('Aplica a: Funcional web · UX', { exact: true })).toBeVisible();
    await expect(functional).toHaveCount(1);
    await expect(functional.getByRole('checkbox', { name: 'Funcional web', exact: true })).toBeChecked();
    await expect(functional.getByRole('checkbox', { name: 'UX', exact: true })).toBeChecked();
    assert.deepEqual(documents.find(doc => doc.filename === 'requisitos-demo.md').testTypes, ['functional_web', 'ux']);
    const existing = card('requisitos-pagos.pdf');
    await existing.getByText('Aplica a: General', { exact: true }).click();
    await existing.getByRole('button', { name: 'Obtener sugerencias' }).click();
    await expect(existing.getByText('Aplica a: Compatibilidad', { exact: true })).toBeVisible();
    await expect(existing.getByRole('checkbox', { name: 'Compatibilidad', exact: true })).toBeChecked();
    await expect(existing.getByRole('button', { name: 'Obtener sugerencias' })).toHaveCount(0);
    await expect(existing.getByRole('checkbox', { name: 'Disponibilidad', exact: true })).not.toBeChecked();
    await existing.getByRole('button', { name: 'Actualizar sugerencias', exact: true }).click();
    await expect(existing.getByRole('checkbox', { name: 'Disponibilidad', exact: true })).toBeChecked();
    await expect(functional.getByRole('button', { name: 'Actualizar sugerencias', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Adjuntar nuevo documento o especificación' }).click();
    await expect(functional).toHaveCount(1);
    await expect(functional.getByText('Aplica a: Funcional web · UX', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(ipaScore).toHaveText('88');
    await expect(documentation.getByText('70%', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Adjuntar nuevo documento o especificación' }).click();
    await dialog.getByRole('button', { name: 'Analizar documentación', exact: true }).click();
    await expect(functional.getByText(/ · Procesado$/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(ipaScore).toHaveText('96');
    await expect(documentation.getByText('90%', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Adjuntar nuevo documento o especificación' }).click();
    await functional.getByRole('button', { name: 'Marcar como validado', exact: true }).click();
    await expect(functional.getByText(/ · Validado$/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(ipaScore).toHaveText('100');
    await expect(documentation.getByText('100%', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'El IPA se actualiza sin recargar la página.');
    console.log('PASS la carga, el análisis y la validación actualizan el IPA sin recargar la página.');
  } finally {
    documents = original;
  }
}

async function verifyQualityScenarios(page) {
  const tools = {
    availability: { tool: 'Node.js', filename: 'disponibilidad.mjs' },
    lighthouse: { tool: 'Lighthouse', filename: 'lighthouse.mjs' },
    load: { tool: 'k6', filename: 'carga.k6.js' },
    ux: { tool: 'Playwright', filename: 'evidencias-ux.mjs' },
  };
  const settings = {
    availability: [{ label: 'Intervalo del monitor', value: '12 min' }, { label: 'Tiempo máximo de respuesta', value: '7000 ms' }],
    lighthouse: [{ label: 'Categorías', value: 'Rendimiento, Accesibilidad, Buenas prácticas, SEO' }],
    load: [{ label: 'Etapa 1', value: '15s · 2 usuarios virtuales' }],
    ux: [{ label: 'Resolución', value: '1280 × 720 px' }, { label: 'Análisis', value: 'Nielsen y WCAG' }],
  };
  const qualityUrl = 'https://example.test/catalogo';
  const fixture = (kind, title, tags, result, href) => {
    const resourceId = randomUUID();
    return {
      id: kind + ':' + resourceId,
      title, tags, requirementId: null,
      steps: [
        { ordinal: 1, action: 'Dado que se configuró el destino del catálogo.' },
        { ordinal: 2, action: 'Cuando AutoQA realiza la comprobación.' },
        { ordinal: 3, action: 'Entonces se registran las métricas correspondientes.' },
      ],
      expectedResult: 'Se registran las métricas correspondientes.',
      quality: {
        kind, resourceId, label: title, result, href, hasResult: true,
        status: { label: 'Finalizada', tone: 'unknown' }, runAt: null, durationMs: null,
        automation: { ...tools[kind], prepared: false },
        executionConfig: {
          environmentId: kind === 'ux' ? null : environment.id, url: qualityUrl, parameters: settings[kind],
          ...(kind === 'availability' && { monitor: { intervalMinutes: 12, timeoutMs: 7000, active: true, method: 'GET', minStatus: 200, maxStatus: 399 } }),
          ...(kind === 'load' && { stages: [{ duration: '15s', target: 2 }] }),
        },
      },
    };
  };
  const saved = new Map(savedPlaywright);
  const runCount = queuedRequests.length;
  const startedKinds = new Set();
  let releasePeers;
  const peersReady = new Promise(resolve => { releasePeers = resolve; });
  qualityWaitForPeers = kind => {
    startedKinds.add(kind);
    if (startedKinds.size === 4) releasePeers();
    return peersReady;
  };
  qualityReviewKind = 'load';
  qualityScenarioRows = [
    fixture('availability', 'Disponibilidad del catálogo', ['@disponibilidad'], 'Última respuesta HTTP 204.', '/projects/' + projectId + '/monitors'),
    fixture('lighthouse', 'Medir la carga del catálogo', ['@performance', '@lighthouse'], 'Puntuación de rendimiento 94/100.', '/projects/' + projectId + '/performance'),
    fixture('load', 'Carga del catálogo', ['@performance', '@carga'], '80 solicitudes.', '/projects/' + projectId + '/load'),
    fixture('ux', 'Revisar usabilidad del catálogo', ['@ux'], '2 hallazgos registrados.'),
  ];

  try {
    await page.reload();
    const tab = page.getByRole('tab', { name: 'Escenarios (' + (scenarios.length + 4) + ')', exact: true });
    await tab.click();
    const panel = page.getByRole('tabpanel', { name: /^Escenarios/ });
    const list = panel.getByRole('list', { name: 'Escenarios del proyecto', exact: true });
    const details = panel.getByRole('complementary', { name: 'Detalle del escenario seleccionado' });
    for (const row of qualityScenarioRows) {
      await list.getByRole('button', { name: row.title, exact: true }).click();
      await expect(details.getByRole('heading', { name: row.title })).toBeVisible();
      for (const keyword of ['Dado', 'Cuando', 'Entonces']) {
        await expect(details.getByText(keyword, { exact: true })).toBeVisible();
      }
      await expect(details.getByRole('heading', { name: /Resultado esperado/ })).toBeVisible();
      await expect(details.getByText(row.quality.result, { exact: true })).toHaveCount(0);
      await expect(details.getByRole('link', { name: 'Ver resultados en Reportes →' })).toHaveAttribute('href', `/projects/${projectId}?resultados=calidad#reporte`);
      await expect(details.getByRole('button', { name: /Ejecutar escenario seleccionado|Editar escenario|Eliminar escenario/ })).toHaveCount(0);
      await expect(list.getByRole('checkbox', { name: 'Seleccionar ' + row.title, exact: true })).toBeDisabled();
      if (row.quality.href) await expect(details.getByRole('link', { name: 'Ver configuración →' })).toHaveAttribute('href', row.quality.href);
    }
    await panel.getByText(/Todas las etiquetas/).click();
    await panel.getByRole('button', { name: '@performance (2)', exact: true }).click();
    await expect(list.getByRole('heading')).toHaveText(['Medir la carga del catálogo', 'Carga del catálogo']);
    console.log('PASS Disponibilidad, Lighthouse, Carga y UX aparecen con el detalle y filtros de Escenarios.');

    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    const automation = page.getByRole('region', { name: 'Automatización de pruebas', exact: true });
    const automationList = automation.getByRole('list', { name: 'Pruebas de automatización', exact: true });
    const generate = automation.getByRole('button', { name: /^Generar seleccionados/ });
    const total = scenarios.filter(item => !item.tags?.includes('@manual')).length + qualityScenarioRows.length;
    await expect(generate).toHaveText('Generar seleccionados (' + total + ')');
    for (const row of qualityScenarioRows) {
      const card = automationList.getByRole('listitem').filter({ has: page.getByRole('heading', { name: row.title, exact: true }) });
      await expect(card.getByText(row.quality.label + ' · ' + row.quality.automation.tool, { exact: true })).toBeVisible();
      await expect(card.getByText(row.quality.result, { exact: true })).toHaveCount(0);
      await expect(card.getByRole('checkbox')).toBeChecked();
      await expect(card.getByText('Pendiente', { exact: true })).toBeVisible();
      if (row.quality.href) await expect(card.getByRole('link', { name: 'Ver configuración →' })).toHaveAttribute('href', row.quality.href);
    }
    await automation.getByRole('button', { name: 'Calidad (4)', exact: true }).click();
    await expect(automationList.getByRole('heading')).toHaveText(qualityScenarioRows.map(row => row.title));
    await expect(generate).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Ejecutar suite (0)', exact: true })).toBeDisabled();
    assert.equal(queuedRequests.length, runCount);
    const selectVisible = automation.getByRole('checkbox', { name: 'Seleccionar visibles (4)', exact: true });
    await selectVisible.uncheck();
    await expect(generate).toHaveText('Generar seleccionados (' + (total - 4) + ')');
    await selectVisible.check();
    await expect(generate).toHaveText('Generar seleccionados (' + total + ')');
    await automation.getByRole('button', { name: 'Todos (' + total + ')', exact: true }).click();
    await automation.getByText(/Todas las etiquetas/).click();
    await automation.getByRole('button', { name: '@performance (2)', exact: true }).click();
    await expect(automationList.getByRole('heading')).toHaveText(['Medir la carga del catálogo', 'Carga del catálogo']);
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(automation.getByText((total - 2) + ' con código guardado · 2 en revisión.', { exact: true })).toBeVisible();
    assert.deepEqual([...startedKinds].sort(), qualityScenarioRows.map(row => row.quality.kind).sort());
    assert.equal(qualityFileRequests.length, 4);
    qualityWaitForPeers = null;
    for (const scenario of scenarios.filter(item => item.steps?.length)) {
      assert.ok(savedPlaywright.has(scenario.id), 'Generación Playwright en lote mixto');
    }
    assert.equal(queuedRequests.length, runCount);
    await page.reload();
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    const incomplete = scenarios.find(item => !item.steps?.length);
    await automationList.getByRole('checkbox', { name: 'Automatizar ' + incomplete.title, exact: true }).uncheck();
    await automation.getByRole('button', { name: 'Calidad (4)', exact: true }).click();
    const loadRow = automationList.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Carga del catálogo', exact: true }) });
    await expect(loadRow.getByText('Requiere revisión', { exact: true })).toBeVisible();
    await expect(loadRow.getByText('Configura un perfil de carga válido.', { exact: true })).toBeVisible();
    await expect(loadRow.getByRole('button', { name: 'Descargar carga.k6.js' })).toHaveCount(0);
    qualityReviewKind = null;
    await generate.click();
    await expect(automation.getByText((total - 1) + ' con código guardado.', { exact: true })).toBeVisible();
    assert.deepEqual(qualityFileRequests.slice(4), [{ kind: 'load', method: 'POST' }]);
    for (const row of qualityScenarioRows) {
      const button = automationList.getByRole('button', { name: 'Descargar ' + row.quality.automation.filename });
      const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
      assert.equal(download.suggestedFilename(), row.quality.automation.filename);
    }
    assert.deepEqual(qualityFileRequests.filter(request => request.method === 'GET').map(request => request.kind),
      qualityScenarioRows.map(row => row.quality.kind));
    await expect(generate).toBeDisabled();
    await expect(selectVisible).toBeChecked();
    await expect(page.getByRole('button', { name: 'Ejecutar suite (3)', exact: true })).toBeEnabled();
    const exclusions = automation.getByRole('status', { name: 'Pruebas de calidad excluidas de la suite' });
    await expect(exclusions).toContainText('1 prueba de calidad con código guardado queda fuera de la suite.');
    await expect(exclusions.getByRole('listitem')).toHaveText('Revisar usabilidad del catálogo · Requiere un entorno y un destino autorizados.');
    await automation.getByRole('button', { name: 'Todos (' + total + ')', exact: true }).click();
    const initialRuns = scenarioRuns.length;
    await page.getByRole('button', { name: 'Ejecutar suite (5)', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Ejecutar suite/ });
    const confirm = dialog.getByRole('button', { name: 'Confirmar ejecución' });
    const authorize = dialog.getByRole('checkbox', { name: /^Confirmo ejecutar/ });
    await expect(confirm).toBeDisabled();
    for (const type of ['Funcional web', 'Mobile emulado', 'Compatibilidad', 'Disponibilidad', 'Performance', 'UX']) {
      await expect(dialog.getByRole('checkbox', { name: 'Seleccionar ' + type, exact: true })).toBeVisible();
    }
    for (const type of ['Mobile emulado', 'Compatibilidad', 'UX']) {
      await expect(dialog.getByRole('checkbox', { name: 'Seleccionar ' + type, exact: true })).toBeDisabled();
    }
    await dialog.getByRole('button', { name: 'Ver pruebas de UX', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: /Revisar usabilidad del catálogo/ })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Seleccionar todas' }).uncheck();
    await expect(dialog).toHaveAccessibleName('Ejecutar suite (0)');
    await authorize.check();
    await expect(confirm).toBeDisabled();
    const chosenQuality = qualityScenarioRows.filter(row => row.quality.kind !== 'ux');
    const performance = dialog.getByRole('checkbox', { name: 'Seleccionar Performance', exact: true });
    await performance.check();
    await dialog.getByRole('button', { name: 'Ver pruebas de Performance', exact: true }).click();
    for (const row of chosenQuality.filter(row => row.quality.kind !== 'availability')) {
      await expect(dialog.getByRole('checkbox', { name: row.title, exact: true })).toBeChecked();
    }
    const loadTest = dialog.getByRole('checkbox', { name: chosenQuality.find(row => row.quality.kind === 'load').title, exact: true });
    await loadTest.uncheck();
    await expect(performance).toHaveJSProperty('indeterminate', true);
    await loadTest.check();
    await dialog.getByRole('checkbox', { name: 'Seleccionar Disponibilidad', exact: true }).check();
    await dialog.getByRole('button', { name: 'Ver pruebas de Funcional web', exact: true }).click();
    await dialog.getByRole('checkbox', { name: scenarios[0].title, exact: true }).check();
    await expect(dialog).toHaveAccessibleName('Ejecutar suite (4)');
    await expect(authorize).not.toBeChecked();
    await dialog.getByText('Configuración de las pruebas de calidad', { exact: true }).click();
    for (const row of chosenQuality) {
      const config = dialog.locator('.suite-quality-settings li').filter({ has: page.getByRole('heading', { name: row.title, exact: true }) });
      await expect(config.getByText(qualityUrl, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole('button', { name: /Editar configuración de Revisar usabilidad/ })).toHaveCount(0);
    const monitor = chosenQuality.find(row => row.quality.kind === 'availability');
    const monitorSettings = dialog.locator('.suite-quality-settings li').filter({ has: page.getByRole('heading', { name: monitor.title, exact: true }) });
    await authorize.check();
    await monitorSettings.getByRole('button', { name: 'Editar configuración de ' + monitor.title }).click();
    await expect(confirm).toBeDisabled();
    await expect(monitorSettings.getByRole('checkbox', { name: 'Monitor activo' })).toBeChecked();
    const urlField = monitorSettings.getByLabel('URL objetivo');
    await expect(urlField).toHaveValue(qualityUrl);
    await urlField.fill('https://outside.test/catalogo');
    await monitorSettings.getByRole('button', { name: 'Guardar configuración' }).click();
    await expect(monitorSettings.getByRole('alert')).toContainText('fuera del alcance autorizado');
    assert.equal(qualityExecutionRequests.size, 0);
    const updatedUrl = qualityUrl + '/carrito';
    await urlField.fill(updatedUrl);
    await monitorSettings.getByLabel('Método HTTP').selectOption('HEAD');
    await monitorSettings.getByLabel('Código HTTP final').fill('204');
    await monitorSettings.getByLabel('Intervalo del monitor (min)').fill('25');
    await monitorSettings.getByLabel('Tiempo máximo de respuesta (ms)').fill('8500');
    await monitorSettings.getByRole('checkbox', { name: 'Monitor activo' }).uncheck();
    await monitorSettings.getByRole('button', { name: 'Guardar configuración' }).click();
    for (const value of [updatedUrl, 'HTTP HEAD · códigos 200 a 204', '25 min', '8500 ms', 'En pausa']) {
      await expect(monitorSettings.getByText(value, { exact: true })).toBeVisible();
    }
    const load = chosenQuality.find(row => row.quality.kind === 'load');
    const loadSettings = dialog.locator('.suite-quality-settings li').filter({ has: page.getByRole('heading', { name: load.title, exact: true }) });
    await loadSettings.getByRole('button', { name: 'Editar configuración de ' + load.title }).click();
    await loadSettings.getByLabel('Duración de etapa 1').fill('30s');
    await loadSettings.getByRole('button', { name: 'Guardar configuración' }).click();
    await expect(loadSettings.getByText('30s · 2 usuarios virtuales', { exact: true })).toBeVisible();
    await expect(authorize).not.toBeChecked();
    assert.equal(qualityExecutionRequests.size, 0);
    assert.deepEqual(monitor.quality.executionConfig.monitor, {
      intervalMinutes: 25, timeoutMs: 8500, active: false, method: 'HEAD', minStatus: 200, maxStatus: 204,
    });
    await authorize.check();
    await confirm.click();
    await expect(dialog.getByText('Finalizada', { exact: true })).toHaveCount(2);
    assert.deepEqual(queuedRequests.slice(runCount).map(request => request.scenarioId), [scenarios[0].id]);
    assert.deepEqual([...qualityExecutionRequests.values()].sort(), ['availability', 'lighthouse', 'load']);
    completeFixtureRun(scenarioRuns.at(-1));
    await expect(dialog.getByText('Ejecuciones finalizadas (4/4).', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    const qualityOnly = qualityScenarioRows.find(row => row.quality.kind === 'ux');
    qualityOnly.quality.executionConfig.environmentId = environment.id;
    await page.reload();
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await automation.getByRole('button', { name: 'Calidad (4)', exact: true }).click();
    await expect(exclusions).toHaveCount(0);
    await page.getByRole('button', { name: 'Ejecutar suite (4)', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Seleccionar Funcional web', exact: true })).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Seleccionar Disponibilidad', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'Seleccionar Performance', exact: true }).uncheck();
    await expect(dialog.getByRole('checkbox', { name: 'Seleccionar UX', exact: true })).toBeChecked();
    await expect(dialog.getByRole('combobox', { name: 'Entorno autorizado' })).toHaveCount(0);
    await authorize.check();
    await confirm.click();
    await expect(dialog.getByText('Ejecuciones finalizadas (1/1).', { exact: true })).toBeVisible();
    assert.deepEqual([...qualityExecutionRequests.values()].sort(), ['availability', 'lighthouse', 'load', 'ux']);
    await dialog.getByRole('button', { name: 'Ver reporte' }).click();
    assert.equal(new URL(page.url()).searchParams.get('resultados'), 'calidad');
    queuedRequests.length = runCount;
    scenarioRuns.length = initialRuns;
    const reports = page.getByRole('tabpanel', { name: 'Reportes', exact: true });
    const qualityReport = reports.getByRole('region', { name: 'Resultados de calidad' });
    await expect(qualityReport).toBeVisible();
    for (const row of qualityScenarioRows) {
      await expect(qualityReport.getByText(row.quality.result, { exact: true })).toBeVisible();
    }
    const qualityTable = qualityReport.getByRole('table', { name: 'Ejecuciones de calidad' });
    await expect(qualityTable.getByRole('row')).toHaveCount(qualityScenarioRows.length + 1);
    const filterQuality = qualityReport.getByRole('combobox', { name: 'Tipo de prueba' });
    await filterQuality.selectOption('availability');
    const monitorRow = qualityTable.getByRole('row').filter({ hasText: monitor.title });
    const openMonitor = monitorRow.getByRole('button', { name: 'Monitoreo de ' + monitor.title, exact: true });
    await expect(monitorRow.getByText('Disponible', { exact: true })).toBeVisible();
    const reportUrl = page.url();
    await openMonitor.click();
    const monitorDetail = page.getByRole('dialog', { name: 'Monitoreo de ' + monitor.title });
    await expect(monitorDetail.getByRole('heading', { name: 'Historial del monitor' })).toBeVisible();
    await expect(monitorDetail.getByText(monitor.quality.executionConfig.url, { exact: true })).toBeVisible();
    const history = monitorDetail.getByRole('table', { name: 'Historial de disponibilidad' });
    await expect(history.getByRole('cell', { name: '204', exact: true })).toBeVisible();
    await expect(history.getByRole('cell', { name: '0 ms', exact: true })).toBeVisible();
    assert.equal(page.url(), reportUrl);
    await monitorDetail.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();
    await expect(monitorDetail).toHaveCount(0);
    await expect(openMonitor).toBeFocused();
    await expect(filterQuality).toHaveValue('availability');

    for (const [kind, link] of [['lighthouse', 'Descargar informe Lighthouse'], ['load', 'Descargar resumen k6'], ['ux', 'Descargar captura UX']]) {
      const row = qualityScenarioRows.find(item => item.quality.kind === kind);
      await filterQuality.selectOption(kind);
      await qualityTable.getByRole('button', { name: 'Evidencias de ' + row.title, exact: true }).click();
      const detail = page.getByRole('dialog', { name: 'Detalle de calidad de ' + row.title, exact: true });
      await expect(detail.getByRole('link', { name: link, exact: true })).toBeVisible();
      if (kind === 'ux') await expect(detail.getByText('Mayor · Campo sin etiqueta')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(detail).toHaveCount(0);
    }
    const [qualityDownload] = await Promise.all([page.waitForEvent('download'),
      qualityReport.getByRole('button', { name: 'Exportar resultados de calidad' }).click()]);
    assert.equal(qualityDownload.suggestedFilename(), 'autoqa-resultados-calidad.json');
    const reportTypes = reports.getByRole('group', { name: 'Tipo de resultados' });
    await reportTypes.getByRole('button', { name: 'Escenarios', exact: true }).click();
    await expect(qualityReport).toHaveCount(0);
    assert.equal(new URL(page.url()).searchParams.get('resultados'), 'escenarios');
    await reportTypes.getByRole('button', { name: 'Todas', exact: true }).click();
    await expect(reports.getByRole('region', { name: 'Resultados de escenarios' })).toBeVisible();
    await expect(qualityReport).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('resultados'), null);
    await reportTypes.getByRole('button', { name: 'Calidad', exact: true }).click();
    await expect(qualityReport).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('resultados'), 'calidad');
    await page.getByRole('tab', { name: 'Calidad', exact: true }).click();
    const qualityPanel = page.getByRole('tabpanel', { name: 'Calidad', exact: true });
    await expect(qualityPanel.getByText('Auditorías Lighthouse', { exact: true })).toHaveCount(0);
    await expect(qualityPanel.getByRole('link', { name: 'Ver resultados en Reportes →' })).toBeVisible();
    await expect(qualityPanel.getByRole('link', { name: /^(Performance · Lighthouse|Carga controlada|Monitores)$/ })).toHaveCount(0);
    await page.goto(new URL(`/projects/${projectId}`, page.url()).href);
    assert.equal(queuedRequests.length, runCount);
    console.log('PASS Reportes reúne resultados y evidencia de los cuatro tipos y Calidad conserva un enlace a Reportes.');
    console.log('PASS La suite confirma la selección y ejecuta los tipos elegidos en una corrida mixta o de calidad.');
    console.log('PASS Generación mixta, estados guardados y descargas para Disponibilidad, Lighthouse, k6, UX y Playwright.');
  } finally {
    releasePeers();
    qualityWaitForPeers = null;
    qualityReviewKind = null;
    qualityScenarioRows = [];
    qualityFileRequests.length = 0;
    qualityExecutionRequests.clear();
    savedPlaywright.clear();
    for (const [id, spec] of saved) savedPlaywright.set(id, spec);
    await page.reload();
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  }
}

async function verifyGenerationForBrowserTypes(page) {
  const original = scenarios;
  const cases = [
    { title: 'Caso funcional web', tag: '@funcional', tags: ['@funcional'] },
    { title: 'Caso móvil emulado', tag: '@mobile', tags: ['@mobile'] },
    { title: '[COMPAT:FIREFOX] Caso de compatibilidad', tag: '@compatibilidad',
      tags: ['@funcional', '@mobile', '@flujoBasico', '@regresion', '@compatibilidad', '@firefox'] },
  ].map(item => ({
    ...item, id: randomUUID(), expectedResult: 'El catálogo está disponible.',
    steps: [{ ordinal: 1, action: 'goto: /' }, { ordinal: 2, action: 'expect-text: Catálogo' }],
  }));
  scenarios = cases;
  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Automatización Playwright', exact: true });
    const generation = panel.getByRole('region', { name: 'Generar código de automatización', exact: true });
    await expect(generation.getByText(/Funcional web, Mobile emulado o Compatibilidad/)).toBeVisible();
    const list = panel.getByRole('list', { name: 'Escenarios para Playwright', exact: true });
    for (const item of cases) {
      const row = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: item.title, exact: true }) });
      await expect(row.getByText(item.tag, { exact: true })).toBeVisible();
      await expect(row.getByRole('checkbox')).toBeChecked();
    }
    const generate = generation.getByRole('button', { name: 'Generar seleccionados (3)', exact: true });
    await generate.click();
    await expect(panel.getByText('3 con código guardado.', { exact: true })).toBeVisible();
    for (const item of cases) assert.ok(savedPlaywright.has(item.id), item.title + ' debe recibir código.');
    await expect(generate).toBeDisabled();
    await page.getByRole('button', { name: 'Ejecutar suite (3)', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Ejecutar suite/ });
    await dialog.getByRole('button', { name: 'Ver pruebas de Compatibilidad', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: cases[2].title, exact: true })).toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Seleccionar Compatibilidad', exact: true }).uncheck();
    await expect(dialog).toHaveAccessibleName('Ejecutar suite (2)');
    for (const type of ['Funcional web', 'Mobile emulado']) {
      await expect(dialog.getByRole('checkbox', { name: 'Seleccionar ' + type, exact: true })).toBeChecked();
    }
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('tab', { name: 'Escenarios (3)', exact: true }).click();
    const scenarioList = page.getByRole('list', { name: 'Escenarios del proyecto', exact: true });
    for (const item of cases.slice(1)) {
      await scenarioList.getByRole('checkbox', { name: 'Seleccionar ' + item.title, exact: true }).uncheck();
    }
    await page.getByRole('button', { name: 'Ejecutar suite (1)', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Seleccionar Funcional web', exact: true })).toBeChecked();
    const mobile = dialog.getByRole('checkbox', { name: 'Seleccionar Mobile emulado', exact: true });
    await expect(mobile).not.toBeChecked();
    await mobile.check();
    await expect(dialog).toHaveAccessibleName('Ejecutar suite (2)');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    console.log('PASS Funcional web, Mobile emulado y Compatibilidad se seleccionan por tipo desde Automatización y Escenarios.');
  } finally {
    scenarios = original;
    for (const item of cases) savedPlaywright.delete(item.id);
    await page.reload();
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  }
}

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
    const selection = panel.getByRole('group', { name: 'Selección de escenarios visibles', exact: true });
    await expect(toolbar.getByRole('checkbox')).toHaveCount(0);
    await expect(pageSize).toHaveValue('10');
    await expect(rows).toHaveCount(10);
    await expect(previousPage).toBeDisabled();
    const listBounds = await list.boundingBox();
    const selectionBounds = await selection.boundingBox();
    assert.ok(selectionBounds.y + selectionBounds.height <= listBounds.y, 'La selección queda encima del listado.');
    const paginationBounds = await pagination.boundingBox();
    assert.ok(paginationBounds.y >= listBounds.y + listBounds.height, 'La paginaci\u00f3n queda debajo del listado.');
    await expect(pagination.getByRole('status')).toHaveText('1–10 de 35 · Página 1 de 4');
    await selection.getByRole('checkbox', { name: 'Seleccionar visibles (10)', exact: true }).uncheck();
    if (automation) await expect(panel.getByRole('button', { name: 'Generar seleccionados (25)', exact: true })).toBeEnabled();

    await nextPage.click();
    await expect(rows.first()).toContainText('Caso paginado 11');
    await expect(list).toBeFocused();
    await expect(rows.first()).toBeInViewport();
    await expect(rows.first().getByRole('checkbox')).toBeChecked();
    await expect(selection.getByRole('status')).toContainText('25 seleccionados');
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
    await toolbar.locator('summary[aria-label="Filtrar por etiqueta"]').click();
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
  await search.fill('tc-pag-002');
  await expect(list.locator('.scenario-result')).toHaveCount(1);
  await expect(list.getByText('TC-PAG-002', { exact: true })).toBeVisible();
  await expect(detail.getByText('TC-PAG-002', { exact: true })).toBeVisible();
  await search.fill('fondos insuficientes');
  await expect(list.locator('.scenario-result')).toHaveCount(1);
  await expect(detail.getByRole('heading', { name: scenarios[1].title, exact: true })).toBeVisible();
  await search.fill('');
  const modes = page.getByRole('group', { name: 'Filtrar por resultados' });
  await modes.getByRole('button', { name: 'Con resultados (2)', exact: true }).click();
  await expect(list.locator('.scenario-result')).toHaveCount(2);
  const tagMenu = page.locator('summary[aria-label="Filtrar por etiqueta"]:visible');
  const tags = page.getByRole('group', { name: 'Opciones de etiqueta' });
  await tagMenu.click();
  await tags.getByRole('button', { name: '@flujoBasico (1)', exact: true }).click();
  await expect(list.locator('.scenario-result')).toHaveCount(1);
  await tagMenu.click();
  await tags.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await modes.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Seleccionar visibles (3)', exact: true }).uncheck();
  await search.fill('tokenizada');
  await page.getByRole('checkbox', { name: 'Seleccionar visibles (1)', exact: true }).check();
  await search.fill('');
  const exportButton = page.getByRole('button', { name: 'Exportar set', exact: true });
  const formats = page.getByRole('group', { name: 'Formatos de exportación', exact: true });
  await exportButton.click();
  await expect(formats.getByRole('button')).toHaveText(['CSV', 'JSON', 'PDF', 'Excel', 'Feature']);
  await page.keyboard.press('Escape');
  await expect(formats).toBeHidden();
  await expect(exportButton).toBeFocused();

  async function downloadFormat(format, extension) {
    await exportButton.click();
    const pending = page.waitForEvent('download');
    await formats.getByRole('button', { name: format, exact: true }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), 'autoqa-escenarios.' + extension);
    await expect(formats).toBeHidden();
    return readFile(await download.path(), 'utf8');
  }

  const featureContent = await downloadFormat('Feature', 'feature');
  assert.ok(featureContent.includes('Vista derivada'));
  assert.ok(featureContent.includes(scenarioA));
  assert.ok(featureContent.includes('goto: /checkout'));
  assert.ok(!featureContent.includes(scenarioB), 'Exporta sólo los escenarios seleccionados.');
  const csv = await downloadFormat('CSV', 'csv');
  assert.ok(csv.startsWith('\uFEFF"ID","Título","Requisito"') && csv.includes(scenarioA) && !csv.includes(scenarioB));
  const json = JSON.parse(await downloadFormat('JSON', 'json'));
  assert.equal(json.project, project.name);
  assert.deepEqual(json.scenarios.map(item => item.id), [scenarioA]);

  const selected = list.getByRole('checkbox', { name: 'Seleccionar ' + scenarios[0].title, exact: true });
  await selected.uncheck();
  const allScenarios = JSON.parse(await downloadFormat('JSON', 'json'));
  assert.deepEqual(allScenarios.scenarios.map(item => item.id), scenarios.map(item => item.id));
  await selected.check();
  await list.getByRole('button', { name: scenarios[2].title, exact: true }).click();
  await expect(detail.getByText('No declarado. Pendiente de definir.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar detalle del escenario', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await list.getByRole('button', { name: scenarios[0].title, exact: true }).click();
  for (const width of [768, 421, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await exportButton.click();
    const menuBounds = await formats.boundingBox();
    assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width, `El menú Exportar cabe a ${width}px.`);
    await page.keyboard.press('Escape');
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
  await form.getByLabel('Historia o requisito asociado').selectOption(requirement.id);
  await form.getByLabel('Primer paso', { exact: true }).fill('goto: /qa');
  await form.getByRole('button', { name: 'Crear escenario', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Escenarios (4)', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Escenario creado desde el nuevo diseño', exact: true })).toBeVisible();
  const originalSteps = scenarios[0].steps;
  await detail.getByRole('button', { name: 'Editar escenario', exact: true }).click();
  const bdd = detail.getByRole('group', { name: 'Pasos del escenario', exact: true });
  await expect(bdd.getByRole('combobox', { name: 'Palabra clave del paso 1', exact: true })).toHaveValue('Dado');
  await expect(bdd.getByRole('textbox', { name: 'Texto del paso 1', exact: true })).toHaveValue('Abre la página «/checkout».');
  await expect(bdd.getByRole('button', { name: 'Editar pasos técnicos', exact: true })).toHaveCount(0);
  await bdd.getByRole('button', { name: 'Agregar paso', exact: true }).click();
  const draftStep = bdd.getByRole('textbox', { name: 'Texto del paso 4', exact: true });
  const suggestions = bdd.getByRole('group', { name: 'Pasos sugeridos', exact: true });
  await draftStep.fill('No existe este paso');
  await expect(draftStep).toHaveCSS('background-color', 'rgb(255, 241, 225)');
  await expect(bdd.getByText('Paso nuevo · Sin coincidencias', { exact: true })).toBeVisible();
  await expect(suggestions).toBeHidden();
  await draftStep.fill('confirmacion');
  await expect(draftStep).not.toHaveCSS('background-color', 'rgb(255, 241, 225)');
  await suggestions.getByRole('button', { name: /Comprueba que aparece «Confirmación»/ }).click();
  await expect(draftStep).toHaveValue('Comprueba que aparece «Confirmación» en la página.');
  await expect(suggestions).toBeHidden();
  await bdd.getByRole('button', { name: 'Quitar paso 4', exact: true }).click();
  await detail.getByLabel('Título', { exact: true }).fill('Pago sandbox editado');
  await detail.getByLabel('@flujoAlterno', { exact: true }).check();
  await detail.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Pago sandbox editado', exact: true })).toBeVisible();
  assert.deepEqual(scenarios[0].steps, originalSteps);
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
  await dialog.getByRole('checkbox', { name: /^Confirmo ejecutar/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar ejecución', exact: true }).click();
  await expect(dialog.getByText('En cola', { exact: true })).toBeVisible();
  assert.deepEqual(queuedRequests, [{ scenarioId: scenarioA, environmentId: environment.id, automationId: fixtureSpec(scenarios[0]).automationId }]);
  await finishFixtureRun(dialog);
  await openSuiteReport(page, dialog);
  await page.getByRole('tab', { name: 'Escenarios (4)', exact: true }).click();
  await expect(list.locator('.scenario-result').filter({ hasText: 'Pago sandbox editado' }).getByText('Pasó · 450 ms', { exact: true })).toBeVisible();
  await list.getByRole('checkbox', { name: 'Seleccionar Pago sandbox editado', exact: true }).uncheck();
  await list.getByRole('checkbox', { name: `Seleccionar ${scenarios[1].title}`, exact: true }).check();
  await execute.click();
  dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox', { name: /^Confirmo ejecutar/ }).check();
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
  await expect(page.getByRole('button', { name: 'Exportar set', exact: true })).toBeDisabled();
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
  const runner = page.getByRole('button', { name: 'Ejecutar suite (2)', exact: true });

  try {
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await expect(second.getByText('Pendiente', { exact: true })).toBeVisible();
    await expect(section.getByRole('region', { name: 'Visor de código Playwright' })).toHaveCount(0);
    await expect(states.getByRole('button', { name: 'Generado (0)', exact: true })).toBeVisible();
    await rows.nth(2).getByRole('checkbox').uncheck();
    await section.getByRole('button', { name: 'Generar seleccionados (2)', exact: true }).click();
    await expect(runner).toBeEnabled();
    await expect(section.getByText('2 con código guardado.', { exact: true })).toBeVisible();

    await expect(section.getByRole('button', { name: 'Generar seleccionados (2)', exact: true })).toBeDisabled();
    const requestStart = previewRequests.length;
    await page.reload();
    await page.getByRole('tab', { name: 'Escenarios (3)', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Seleccionar ' + scenarios[2].title, exact: true }).uncheck();
    await expect(page.getByRole('button', { name: 'Ejecutar suite (2)', exact: true })).toBeEnabled();
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await expect(section.getByRole('button', { name: 'Generar seleccionados (3)', exact: true })).toBeEnabled();
    await rows.nth(2).getByRole('checkbox').uncheck();
    await expect(section.getByRole('button', { name: 'Generar seleccionados (2)', exact: true })).toBeDisabled();
    await states.getByRole('button', { name: 'Generado (2)', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(second.getByText('Generado', { exact: true })).toBeVisible();
    await expect(second.getByText(/payment-declined\.spec\.ts$/)).toBeVisible();
    assert.equal(previewRequests.length, requestStart, 'El código guardado se reconoce sin solicitar una vista previa.');
    await runner.click();
    const dialog = page.getByRole('dialog', { name: 'Ejecutar suite (2)', exact: true });
    await dialog.getByRole('checkbox', { name: /^Confirmo ejecutar/ }).check();
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
    await expect(section.getByRole('button', { name: 'Generar seleccionados (2)', exact: true })).toBeEnabled();
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
    await page.getByRole('button', { name: 'Ejecutar suite (3)', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ejecutar suite (3)', exact: true });
    await dialog.getByRole('checkbox', { name: /^Confirmo ejecutar/ }).check();
    await dialog.getByRole('button', { name: 'Confirmar ejecución' }).click();
    const rows = dialog.getByRole('listitem');
    const first = rows.filter({ hasText: scenarios[0].title });
    const last = rows.filter({ hasText: extra.title });
    await expect(dialog.getByText('Cuota de ejecuciones alcanzada.', { exact: true })).toBeVisible();
    await expect(dialog.getByText('No ejecutado', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText('Suite en curso · 0 de 3 pruebas finalizadas.', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/No se pudo actualizar el estado/)).toBeVisible();

    await expect(first.getByText('En cola', { exact: true })).toBeVisible();
    await expect(last.getByText('Esperando turno…', { exact: true })).toBeVisible();
    const close = dialog.getByRole('button', { name: 'Cerrar', exact: true });
    const report = dialog.getByRole('button', { name: 'Ver reporte', exact: true });
    await expect(close).toBeEnabled();
    await expect(report).toBeDisabled();
    await close.click();
    await expect(dialog).toBeHidden();
    const indicator = page.getByRole('region', { name: 'Estado de ejecución', exact: true });
    await expect(indicator.getByText('0 de 3 pruebas finalizadas', { exact: true })).toBeVisible();
    await expect(indicator.getByText('0 en ejecución · 1 en cola · 1 por enviar · 1 no ejecutada', { exact: true })).toBeVisible();
    const passed = scenarioRuns[initialRuns];
    passed.status = 'RUNNING';
    await expect(indicator.getByText('En ejecución · ' + scenarios[0].title, { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(indicator.getByText('1 en ejecución · 0 en cola · 1 por enviar · 1 no ejecutada', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: /^Escenarios/ }).click();
    await page.getByRole('button', { name: 'Ver suite', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(first.getByText('En ejecución', { exact: true })).toBeVisible();
    await expect(report).toBeDisabled();
    await close.click();
    await expect(dialog).toBeHidden();

    assert.equal(scenarioRuns.length - initialRuns, 1);
    assert.deepEqual(trackedRunRequests[firstPoll], [passed.id]);
    completeFixtureRun(passed);
    await expect.poll(() => scenarioRuns.length - initialRuns, { timeout: 10000 }).toBe(2);
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await expect(indicator.getByText('1 de 3 pruebas finalizadas', { exact: true })).toBeVisible();
    await expect(indicator.getByText('0 en ejecución · 1 en cola · 1 no ejecutada', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ver suite', exact: true }).click();
    await expect(first.getByText('Pasó', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(report).toBeDisabled();
    await expect(last.getByText('En cola', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText('Suite en curso · 1 de 3 pruebas finalizadas.', { exact: true })).toBeVisible();
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
    await expect(report).toBeEnabled();
    await openSuiteReport(page, dialog);
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await expect(indicator.getByText('2 de 3 pruebas finalizadas', { exact: true })).toBeVisible();
    await expect(indicator.getByRole('progressbar')).toHaveAttribute('value', '2');
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
  console.log('PASS Cerrar mantiene la suite en seguimiento y Ver reporte abre Reportes cuando termina.');
}

async function verifyAutomationRunStatus(page) {
  const initialRuns = scenarioRuns.length;
  const queued = { ...scenarioRuns[0], id: randomUUID(), status: 'QUEUED', results: [], createdAt: new Date(Date.now() - 125000).toISOString() };

  try {
    scenarioRuns.push(queued);
    activityUnavailable = true;
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    const indicator = page.getByRole('region', { name: 'Estado de ejecución', exact: true });
    const status = indicator.getByRole('status');
    const tests = page.getByRole('region', { name: 'Escenarios para Playwright', exact: true });
    await expect(status.getByText('No se pudo consultar el estado. Reintentando…', { exact: true })).toBeVisible();
    const indicatorBounds = await indicator.boundingBox();
    const testsBounds = await tests.boundingBox();
    assert.ok(indicatorBounds.y + indicatorBounds.height <= testsBounds.y);

    activityUnavailable = false;
    await expect(status.getByText('0 en ejecución · 1 en cola', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(status.getByText('La prueba más antigua lleva 2 min en cola.', { exact: true })).toBeVisible();
    const stop = indicator.getByRole('button', { name: 'Detener ejecución', exact: true });
    await expect(stop).toBeEnabled();
    queued.status = 'RUNNING';
    const pending = { ...queued, id: randomUUID(), status: 'QUEUED' };
    scenarioRuns.push(pending);
    await expect(status.getByText('1 en ejecución · 1 en cola', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(status.getByText('El runner ya tomó pruebas del proyecto.', { exact: true })).toBeVisible();
    const initialStops = stopRequests;
    await stop.click();
    await expect(status.getByText('0 en ejecución · 0 en cola · 1 deteniéndose', { exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Ejecutar suite (2)', exact: true }).click();
    const suite = page.getByRole('dialog', { name: 'Ejecutar suite (2)', exact: true });
    await suite.getByRole('checkbox', { name: /^Confirmo ejecutar/ }).check();
    await suite.getByRole('button', { name: 'Confirmar ejecución' }).click();
    await expect.poll(() => queuedRequests.length - initialQueues).toBe(1);
    await suite.getByRole('button', { name: 'Cerrar', exact: true }).click();
    const indicator = page.getByRole('region', { name: 'Estado de ejecución', exact: true });
    await indicator.getByRole('button', { name: 'Detener ejecución', exact: true }).click();
    await expect(indicator.getByRole('button', { name: 'Deteniendo…' })).toBeDisabled();
    assert.equal(stopRequests, initialStops);
    release();

    await expect(indicator.getByRole('button', { name: 'Deteniendo…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ejecutar suite (2)', exact: true })).toBeEnabled();
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
  const tags = toolbar.getByRole('group', { name: 'Opciones de etiqueta' });
  const tagMenu = toolbar.locator('summary[aria-label="Filtrar por etiqueta"]');
  const search = toolbar.getByRole('searchbox', { name: 'Buscar escenarios para Playwright' });
  const rows = section.locator('.automation-pick-list > li');
  await expect(rows).toHaveCount(3);
  await expect(states.getByRole('button', { name: 'Generado (1)', exact: true })).toBeVisible();
  await states.getByRole('button', { name: 'Pendiente (2)', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await tagMenu.click();
  await tags.getByRole('button', { name: '@apiRest (1)', exact: true }).click();
  await expect(rows).toHaveCount(1);
  const selection = section.getByRole('region', { name: 'Escenarios para Playwright', exact: true })
    .getByRole('group', { name: 'Selección de escenarios visibles', exact: true });
  await selection.getByRole('checkbox', { name: 'Seleccionar visibles (1)', exact: true }).uncheck();
  await expect(selection.getByRole('status')).toHaveText('2 seleccionados · 1 visibles');
  await expect(section.getByRole('button', { name: 'Generar seleccionados (2)', exact: true })).toBeEnabled();

  await tagMenu.click();
  await tags.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await states.getByRole('button', { name: 'Todos (3)', exact: true }).click();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await search.fill(fixtureSpec(scenarios[0]).filename);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(scenarios[0].title);
  await search.clear();

  await rows.nth(1).getByRole('checkbox').check();
  specFailure = true;
  try {
    await section.getByRole('button', { name: 'Generar seleccionados (3)', exact: true }).click();
    await states.getByRole('button', { name: 'Error (1)', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(scenarios[1].title);
    await rows.first().getByRole('checkbox').uncheck();
  } finally {
    specFailure = false;
  }
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
    await page.getByRole('button', { name: 'Ejecutar suite (1)', exact: true }).click();
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
    await expect(dialog.getByText('En cola', { exact: true })).toBeVisible();
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
  const initialQueues = queuedRequests.length;
  await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await expect(section.getByRole('region', { name: 'Visor de código Playwright' })).toHaveCount(0);
  const generation = section.getByRole('region', { name: 'Generar código de automatización' });
  const generate = generation.getByRole('button', { name: 'Generar seleccionados (4)', exact: true });
  await expect(generate).toBeVisible();
  await expect(section.getByRole('button', { name: /^Generar seleccionados/ })).toHaveCount(1);
  const cardBounds = await generation.boundingBox();
  const listBounds = await section.locator('.automation-scenarios').boundingBox();
  assert.ok(cardBounds.y + cardBounds.height <= listBounds.y, 'El bloque de generación queda encima de la lista.');
  await generate.click();
  await expect(section.getByText('2 con código guardado · 2 en revisión.', { exact: true })).toBeVisible();
  await expect(section.locator('.automation-generation-state').getByText('Generado', { exact: true })).toHaveCount(2);
  await expect(section.locator('.automation-generation-state').getByText('Requiere revisión', { exact: true })).toHaveCount(2);
  assert.equal(queuedRequests.length, initialQueues, 'Generar y visualizar no encola ejecuciones.');
  await expect(section.getByRole('tablist', { name: 'Archivos de automatización' })).toHaveCount(0);
  await expect(section.locator('pre')).toHaveCount(0);
  await page.setViewportSize({ width: 1170, height: 1000 });
  const panelBounds = await section.boundingBox();
  const scenariosBounds = await section.locator('.automation-scenarios').boundingBox();
  assert.equal(scenariosBounds.width, panelBounds.width, 'La lista aprovecha el ancho de Automatización.');
  await page.screenshot({ path: join(screenshots, 'project-automation-desktop.png'), fullPage: true, animations: 'disabled' });
  await expect(page.getByRole('button', { name: 'Descargar .spec.ts (.zip)', exact: true })).toHaveCount(0);

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
      const mobileStatus = await section.getByRole('region', { name: 'Estado de ejecución' }).boundingBox();
      const mobileList = await section.locator('.automation-scenarios').boundingBox();
      assert.ok(mobileStatus.y + mobileStatus.height <= mobileList.y);
      await page.screenshot({ path: join(screenshots, 'project-automation-mobile.png'), fullPage: true, animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  const all = section.getByRole('checkbox', { name: 'Seleccionar visibles (4)', exact: true });
  await all.uncheck();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[0].title}`, exact: true }).check();
  const execute = page.getByRole('button', { name: 'Ejecutar suite (1)', exact: true });
  await execute.click();
  let dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(queuedRequests.length, initialQueues);
  await execute.click(); dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox', { name: /^Confirmo ejecutar/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar ejecución', exact: true }).click();
  await expect(dialog.getByText('En cola', { exact: true })).toBeVisible();
  assert.equal(queuedRequests.at(-1).environmentId, environment.id);
  await finishFixtureRun(dialog);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[0].title}`, exact: true }).uncheck();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[2].title}`, exact: true }).check();
  await expect(page.getByRole('button', { name: 'Ejecutar suite (0)', exact: true })).toBeDisabled();
  await expect(section.getByText('Sin pasos definidos', { exact: false }).first()).toBeVisible();

  scenarios[1].title += ' · contrato actualizado';
  malformedSpec = true;
  await section.getByRole('button', { name: 'Actualizar escenarios de automatización', exact: true }).click();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[2].title}`, exact: true }).uncheck();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[1].title}`, exact: true }).check();
  await section.getByRole('button', { name: 'Generar seleccionados (1)', exact: true }).click();
  await expect(section.getByText('La API no devolvió un archivo de código válido.', { exact: true }).first()).toBeVisible();
  malformedSpec = false; specFailure = true;
  await section.getByRole('button', { name: 'Reintentar archivo', exact: true }).click();
  await expect(section.getByText('Generador temporalmente no disponible.', { exact: true }).first()).toBeVisible();
  await all.uncheck();
  await section.getByRole('checkbox', { name: `Automatizar ${scenarios[1].title}`, exact: true }).check();
  await section.getByRole('button', { name: 'Generar seleccionados (1)', exact: true }).click();
  await expect(section.getByText('Algunos archivos no se pudieron generar. Revisa los errores por escenario.', { exact: true })).toBeVisible();
  specFailure = false;
  await section.getByRole('button', { name: 'Reintentar archivo', exact: true }).click();
  await expect(rows.filter({ hasText: scenarios[1].title }).getByText('Generado', { exact: true })).toBeVisible();
  await expect(section.locator('pre')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ejecutar suite (1)', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Ejecutar suite (1)', exact: true });
  await dialog.getByRole('checkbox', { name: /^Confirmo ejecutar/ }).check();
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
  await expect(section.getByRole('button', { name: 'Generar seleccionados (0)', exact: true })).toBeDisabled();
  scenarios = populated;
  project.status = 'DRAFT';
  await page.reload();
  await section.getByRole('button', { name: 'Generar seleccionados (4)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ejecutar suite (2)', exact: true })).toBeDisabled();
  project.status = 'READY';
  await page.reload();
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  console.log('PASS automatización: lista sin visor, revisión sin falsos validados, cabecera común/móvil, confirmación y cuota, caché invalidada, errores y reintentos. API simulada, sin worker real.');
}

async function verifyReportEvidence(page) {
  reportMode = true;
  reportExplanationRequests.length = 0;
  reportRepairRequests = 0;
  try {
    await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
    const report = page.getByRole('region', { name: 'Reporte de ejecuciones', exact: true });
    await report.getByRole('button', { name: 'Todas', exact: true }).click();
    await expect(report.getByRole('region', { name: 'Resultados de calidad' })).toBeVisible();
    await report.getByRole('button', { name: 'Seleccionar ejecución ' + reportRuns[0].id.slice(0, 8), exact: true }).click();
    const table = report.getByRole('table', { name: 'Ejecuciones registradas' });
    const row = table.getByRole('row').filter({ hasText: reportRuns[0].id.slice(0, 8) });
    const evidence = row.getByRole('button', { name: /^Ver evidencias de/ });
    await expect(row.getByRole('link', { name: /traza/i })).toHaveCount(0);
    await evidence.click();
    const dialog = page.getByRole('dialog', { name: /^Evidencias de/ });
    await expect(dialog.getByRole('button', { name: 'Ver error', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'Capturas por paso' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Descargar imagen' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Descargar video' })).toBeVisible();
    const trace = dialog.getByRole('link', { name: 'Descargar traza (.zip)', exact: true });
    await expect(trace).toBeVisible();
    const traceResponse = await page.request.get(new URL(await trace.getAttribute('href'), page.url()).href);
    assert.equal(traceResponse.status(), 200);
    assert.ok((await JSZip.loadAsync(await traceResponse.body(), { checkCRC32: true })).file('trace.fixture.json'));
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(evidence).toBeFocused();

    const failedRun = reportRuns[1];
    await report.getByRole('button', { name: 'Seleccionar ejecución ' + failedRun.id.slice(0, 8), exact: true }).click();
    const failedEvidence = table.getByRole('row').filter({ hasText: failedRun.id.slice(0, 8) })
      .getByRole('button', { name: /^Ver evidencias de/ });
    await failedEvidence.click();
    const detail = dialog.getByRole('region', { name: 'Error de la ejecución' });
    await expect(detail).toContainText(reportError.replace(/\u0000/g, ''));
    await expect(detail.locator('evil')).toHaveCount(0);
    await expect(detail.getByText('El agente no pudo generar una explicación en este momento.')).toBeVisible();
    await detail.getByRole('button', { name: 'Reintentar análisis' }).click();
    await expect(detail).toContainText(reportExplanation);
    await dialog.getByRole('button', { name: 'Ocultar error' }).click();
    await expect(detail).toBeHidden();
    await dialog.getByRole('button', { name: 'Ver error' }).click();
    await expect(detail).toContainText('Comprueba la respuesta del servicio de checkout.');
    await page.keyboard.press('Escape');
    await failedEvidence.click();
    await expect(detail).toContainText(reportExplanation);
    assert.deepEqual(reportExplanationRequests, [failedRun.results[0].id, failedRun.results[0].id]);
    await expect(detail).toContainText('iframe[id="checkout"]');
    assert.equal(reportRepairRequests, 0);
    const apply = detail.getByRole('button', { name: 'Aplicar solución', exact: true });
    await apply.click();
    await expect(detail).toContainText('Solución aplicada al código.');
    await expect(apply).toBeDisabled();
    assert.equal(reportRepairRequests, 1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    const blockedRun = reportRuns[2];
    await report.getByRole('button', { name: 'Seleccionar ejecución ' + blockedRun.id.slice(0, 8), exact: true }).click();
    await table.getByRole('row').filter({ hasText: blockedRun.id.slice(0, 8) }).getByRole('button', { name: /^Ver evidencias de/ }).click();
    await expect(detail).toContainText('No se registró un mensaje de error para esta ejecución.');
    await expect(detail.getByRole('heading', { name: 'Descripción y posible solución' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Aplicar solución' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    console.log('PASS Reportes abre el error y el análisis de la ejecución seleccionada, con reintento y reutilización.');
  } finally {
    reportMode = false;
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  }
}

async function verifyManualEvidenceDialog(page) {
  const savedRuns = scenarioRuns;
  const id = randomUUID();
  const viewport = page.viewportSize();
  scenarioRuns = [{
    ...savedRuns[0], id: 'manual-pending-' + id, scenarioId: id,
    scenario: { id, title: 'Verificar producto manualmente', tags: ['@manual'] },
    results: [{ id: 'manual-result-' + id, status: 'SKIPPED', durationMs: null, errorMessage: null, evidenceKey: null }],
  }];
  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Adjuntar evidencia', exact: true });
    await trigger.click();
    const modal = page.getByRole('dialog', { name: 'Adjuntar evidencia manual' });
    const save = modal.getByRole('button', { name: 'Guardar evidencia', exact: true });
    const selector = modal.getByRole('button', { name: 'Seleccionar imágenes', exact: true });
    const fileInput = modal.locator('input[type="file"]');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('combobox', { name: 'Estado del escenario' })).toHaveValue('SKIPPED');
    await expect(fileInput).toBeHidden();
    await expect(save).toBeDisabled();
    const background = await modal.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.match(background, /^rgb\(/, 'El fondo del diálogo debe ser opaco.');
    await modal.getByRole('textbox', { name: 'Notas (opcional)' }).fill('El resultado quedó registrado.');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), selector.click()]);
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const context = canvas.getContext('2d');
      context.fillStyle = '#2266cc';
      context.fillRect(0, 0, 2, 2);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await chooser.setFiles({ name: 'evidencia.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
    const preview = modal.getByRole('img', { name: 'Evidencia 1', exact: true });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(canvas => {
      const pixel = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return [...pixel];
    })).toEqual([34, 102, 204, 255]);
    await expect(save).toBeEnabled();

    await page.setViewportSize({ width: 390, height: 620 });
    const panel = await modal.boundingBox();
    const footer = await save.boundingBox();
    assert.ok(panel.x >= 12 && panel.x + panel.width <= 378, 'El diálogo conserva márgenes en móvil.');
    assert.ok(footer.y + footer.height <= panel.y + panel.height, 'La acción de guardar queda dentro del diálogo.');
    await modal.getByRole('button', { name: 'Quitar imagen 1', exact: true }).click();
    await expect(save).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    console.log('PASS El formulario manual tiene fondo opaco, selector único, vista previa y controles accesibles en móvil.');
  } finally {
    scenarioRuns = savedRuns;
    await page.setViewportSize(viewport);
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await page.reload();
  }
}

async function verifyPrimaryReportTags(page) {
  const savedScenarios = scenarios;
  const savedRuns = scenarioRuns;
  const labels = [
    ['@funcional', '@flujoBasico', '@login', '@smoke'],
    ['@manual', '@flujoAlterno', '@checkout'],
    ['@compatibility', '@compatibilidad', '@mobile', '@firefox', '@regresion'],
  ];
  scenarios = savedScenarios.slice(0, labels.length).map((scenario, index) => ({ ...scenario, tags: labels[index] }));
  scenarioRuns = scenarios.map(scenario => ({
    ...savedRuns[0], id: randomUUID(), scenarioId: scenario.id,
    scenario: { id: scenario.id, title: scenario.title, tags: scenario.tags },
  }));
  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
    const report = page.getByRole('region', { name: 'Resultados de escenarios' });
    const table = report.getByRole('table', { name: 'Ejecuciones registradas' });
    const tagsMenu = report.getByLabel('Filtrar por etiqueta actual del escenario', { exact: true });
    await expect(tagsMenu).toHaveText('Todas las etiquetas (6)');
    await tagsMenu.click();
    const options = report.getByRole('group', { name: 'Opciones de etiqueta' });
    const tags = ['Todas (6)', '@compatibilidad', '@flujoAlterno', '@flujoBasico', '@funcional', '@manual', '@mobile'];
    assert.deepEqual(await options.getByRole('button').allTextContents(), tags);
    await expect(table.locator('.run-report-tags > span')).toHaveText(['@funcional', '@flujoBasico', '@manual', '@flujoAlterno', '@mobile', '@compatibilidad']);

    await options.getByRole('button', { name: '@manual', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table.getByText('@manual', { exact: true })).toBeVisible();

    await tagsMenu.click();
    await options.getByRole('button', { name: 'Todas (6)', exact: true }).click();
    await report.getByRole('searchbox', { name: 'Buscar ejecuciones' }).fill('@login');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table.getByText('@funcional', { exact: true })).toBeVisible();
    console.log('PASS Reportes muestra solo los tipos de prueba y los flujos, y conserva la búsqueda por etiquetas guardadas.');
  } finally {
    scenarios = savedScenarios;
    scenarioRuns = savedRuns;
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await page.reload();
  }
}

async function verifyReportPagination(page) {
  const savedRuns = scenarioRuns;
  const cases = Array.from({ length: 13 }, (_, index) => {
    const id = randomUUID();
    return {
      ...savedRuns[0], id: randomUUID(), scenarioId: id,
      scenario: { id, title: (index === 12 ? 'Caso omitible ' : 'Caso de reporte ') + (index + 1) },
      status: 'COMPLETED', createdAt: new Date(Date.UTC(2026, 10, 19, 12, 20 - index)).toISOString(),
    };
  });
  scenarioRuns = cases;
  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
    const report = page.getByRole('region', { name: 'Resultados de escenarios' });
    const navigation = report.getByRole('navigation', { name: 'Paginación del reporte' });
    const indicator = navigation.getByRole('status');
    const next = navigation.getByRole('button', { name: 'Página siguiente' });
    const previous = navigation.getByRole('button', { name: 'Página anterior' });
    const table = report.getByRole('table', { name: 'Ejecuciones registradas' });
    await expect(indicator).toHaveText('1–10 de 13 · Página 1 de 2');
    await next.click();
    await expect(indicator).toHaveText('11–13 de 13 · Página 2 de 2');
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table.getByText(cases[10].scenario.title, { exact: true })).toBeVisible();
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(indicator).toHaveText('1–10 de 13 · Página 1 de 2');

    await next.click();
    await report.getByRole('searchbox', { name: 'Buscar ejecuciones' }).fill('Caso de reporte');
    await expect(indicator).toHaveText('1–10 de 12 · Página 1 de 2');
    await next.click();
    await expect(indicator).toHaveText('11–12 de 12 · Página 2 de 2');
    console.log('PASS Reportes permite avanzar, retroceder y volver a la primera página al filtrar.');
  } finally {
    scenarioRuns = savedRuns;
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await page.reload();
  }
}

async function verifyRunReport(page, screenshots) {
  reportMode = true;
  const initialQueues = queuedRequests.length;
  const reportsTab = page.getByRole('tab', { name: 'Reportes', exact: true });
  const dataTab = page.getByRole('tab', { name: 'Datos', exact: true });
  async function reopenReport() {
    await dataTab.click();
    await reportsTab.click();
  }
  await reportsTab.click();
  const section = page.getByRole('region', { name: 'Reporte de ejecuciones', exact: true });
  const table = section.getByRole('table', { name: 'Ejecuciones registradas', exact: true });
  const selector = page.getByLabel('Ejecución del reporte', { exact: true });
  const filter = section.getByRole('group', { name: 'Estado de ejecución' });
  await expect(page.getByRole('button', { name: 'Actualizar reporte', exact: true })).toHaveCount(0);
  const search = section.getByRole('searchbox', { name: 'Buscar ejecuciones' });
  await expect(selector).toHaveValue('latest');
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(filter.getByRole('button', { name: 'Todos (2)', exact: true })).toBeVisible();
  const retry = {
    ...reportRuns[6], id: randomUUID(), createdAt: '2026-11-18T12:08:00Z',
    status: 'QUEUED', errorCode: null, results: [],
  };
  try {
    reportRuns.push(retry);
    await reopenReport();
    const row = table.getByRole('row').filter({ hasText: retry.id.slice(0, 8) });
    await expect(row.getByText('En cola', { exact: true })).toBeVisible();
    await search.focus();
    retry.status = 'COMPLETED';
    retry.results = [{ ...reportRuns[0].results[0], id: randomUUID(), evidenceKey: null }];
    await expect(row.getByText('Pasó', { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(search).toBeFocused();
    await expect(filter.getByRole('button', { name: 'Todos (2)', exact: true })).toBeVisible();
    await expect(filter.getByRole('button', { name: 'Exitosos (1)', exact: true })).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByText(reportRuns[6].id.slice(0, 8), { exact: true })).toHaveCount(0);
  } finally {
    reportRuns.pop();
  }
  await reopenReport();
  await selector.selectOption('all');
  await expect(table.getByRole('row')).toHaveCount(8);
  await expect(section.getByRole('region', { name: 'Tasa de éxito', exact: true }).getByText('25%', { exact: true })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Tiempo registrado', exact: true }).getByText('4.6 s', { exact: true })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Flakiness y reintentos', exact: true }).getByText('No disponible', { exact: true })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Cobertura de aserciones', exact: true }).getByText('No disponible', { exact: true })).toBeVisible();
  await expect(table.getByText('CHROMIUM', { exact: true })).toBeVisible();
  await expect(table.getByRole('link', { name: /traza/i })).toHaveCount(0);
  assert.ok(!(await section.textContent()).includes('private-internal-key'));
  await page.setViewportSize({ width: 1170, height: 1000 });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(screenshots, 'project-runs-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Control+k'); await expect(search).toBeFocused();
  await search.fill('callback'); await expect(table.getByRole('row')).toHaveCount(4);
  await search.fill('');
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
  const exportTrigger = page.getByText('Exportar resultados', { exact: true });
  const xmlButton = page.getByRole('button', { name: 'Exportar JUnit XML', exact: true });
  const jsonButton = page.getByRole('button', { name: 'Exportar JSON', exact: true });
  await exportTrigger.click();
  await expect(xmlButton).toBeVisible();
  await search.click();
  await expect(xmlButton).toBeHidden();
  await exportTrigger.click();
  await page.keyboard.press('Escape');
  await expect(xmlButton).toBeHidden();
  await exportTrigger.click();
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
  const firstHistoryItem = section.getByRole('button', { name: 'Seleccionar ejecución ' + firstCanceled.id.slice(0, 8), exact: true });
  await firstHistoryItem.click();
  await expect(detail).toBeVisible();
  firstCanceled.status = 'CANCELED';
  firstCanceled.errorCode = 'canceled-by-user';
  await expect(firstHistoryItem).toHaveCount(0, { timeout: 12000 });
  await expect(selector).toHaveValue('latest');
  await expect(selector.locator('option').filter({ hasText: firstCanceled.id.slice(0, 8) })).toHaveCount(0);
  await expect(detail).toHaveCount(0);
  await selector.selectOption('all');
  await expect(table.getByText(firstCanceled.id.slice(0, 8), { exact: true })).toHaveCount(0);
  await expect(table.getByText(secondCanceled.id.slice(0, 8), { exact: true })).toBeVisible();
  await exportTrigger.click();
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
    await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(6);
    const after = await page.locator('.app-shell-body').boundingBox();
    assert.equal(before.x, after.x); assert.equal(before.width, after.width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Reporte sin desbordamiento a ${width}px.`);
    if (width === 390) await page.screenshot({ path: join(screenshots, 'project-runs-mobile.png'), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  assert.equal(queuedRequests.length, initialQueues, 'Ningún trabajo se encola al abrir el reporte.');
  historyFail = true;
  await reopenReport();
  await expect(section.getByText('No se pudo consultar el historial de ejecuciones.', { exact: true })).toBeVisible();
  historyFail = false;
  await section.getByRole('button', { name: 'Reintentar reporte', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(6);
  reportForbidden = true;
  await reopenReport();
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
  await expect(panel.getByRole('link', { name: 'Ver resultados en Reportes →' })).toBeVisible();
  await expect(panel.getByText('Auditorías Lighthouse', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Configurar auditoría', exact: true })).toHaveAttribute('href', `/projects/${projectId}/performance`);
  await page.setViewportSize({ width: 1170, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(screenshots, 'project-quality-desktop.png'), fullPage: true, animations: 'disabled' });
  const exportTrigger = page.getByText('Exportar informe', { exact: true });
  const downloadButton = page.getByRole('button', { name: 'Descargar informe JSON', exact: true });
  await exportTrigger.click();
  await expect(downloadButton).toBeVisible();
  await page.getByRole('heading', { name: project.name, exact: true }).click();
  await expect(downloadButton).toBeHidden();
  await exportTrigger.click();
  await downloadButton.focus();
  await page.keyboard.press('Escape');
  await expect(downloadButton).toBeHidden();
  await expect(exportTrigger).toBeFocused();
  await exportTrigger.click();
  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
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
  await expect(panel.getByText('Sin evaluaciones guardadas.', { exact: true })).toHaveCount(2);
  await expect(health.getByRole('img', { name: 'ICSP: 88 de 100', exact: true })).toBeVisible();
  qualityAuditForbidden = false; qualityEmptyHistory = false;
  await refresh.click();
  await expect(panel.getByRole('link', { name: 'Ver resultados en Reportes →' })).toBeVisible();
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

async function verifyDeleteScenarios(page) {
  const saved = scenarios;
  const savedRuns = scenarioRuns;
  const initialQueues = queuedRequests.length;
  const cases = Array.from({ length: 12 }, (_, index) => ({
    id: '74000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
    title: 'Caso para eliminar ' + (index + 1), tags: [], steps: [],
  }));
  scenarios = cases;
  scenarioRuns = cases.slice(0, 2).map(scenario => ({
    ...savedRuns[0], id: randomUUID(), status: 'COMPLETED',
    scenarioId: scenario.id, scenario: { id: scenario.id, title: scenario.title },
  }));
  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Escenarios (12)', exact: true }).click();
    const tab = page.getByRole('tabpanel', { name: /^Escenarios/ });
    const archive = page.getByRole('button', { name: 'Eliminar escenarios', exact: true });
    const pagination = tab.getByRole('navigation', { name: 'Paginación de escenarios' });
    const first = cases[0], last = cases.at(-1);
    await expect(archive).toBeEnabled();
    await tab.getByRole('checkbox', { name: 'Seleccionar visibles (10)', exact: true }).uncheck();
    await pagination.getByRole('button', { name: 'Página siguiente' }).click();
    await tab.getByRole('checkbox', { name: 'Seleccionar visibles (2)', exact: true }).uncheck();
    await expect(archive).toBeDisabled();
    await tab.getByRole('checkbox', { name: 'Seleccionar ' + last.title, exact: true }).check();
    await pagination.getByRole('button', { name: 'Página anterior' }).click();
    await tab.getByRole('checkbox', { name: 'Seleccionar ' + first.title, exact: true }).check();
    await expect(archive).toBeEnabled();
    page.once('dialog', dialog => dialog.dismiss());
    await archive.click();
    assert.equal(scenarios.length, cases.length);
    page.once('dialog', async dialog => {
      assert.match(dialog.message(), /los 2 escenarios seleccionados y sus ejecuciones/);
      await dialog.accept();
    });
    await archive.click();
    await expect(page.getByText('Se eliminaron 2 escenarios.', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Escenarios (10)', exact: true })).toBeVisible();
    await expect(archive).toBeDisabled();
    assert.deepEqual(scenarios.map(scenario => scenario.id), cases.slice(1, -1).map(scenario => scenario.id));
    await expect(tab.getByRole('button', { name: cases[1].title, exact: true })).toBeVisible();
    await expect(tab.getByRole('button', { name: first.title, exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Automatización', exact: true }).click();
    await expect(page.getByRole('heading', { name: cases[1].title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: first.title, exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
    const table = page.getByRole('table', { name: 'Ejecuciones registradas', exact: true });
    await expect(table.getByText(cases[1].title, { exact: true })).toBeVisible();
    await expect(table.getByText(first.title, { exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Escenarios (10)', exact: true }).click();
    await tab.getByRole('button', { name: cases[1].title, exact: true }).click();
    const otherSelection = tab.getByRole('checkbox', { name: 'Seleccionar ' + cases[3].title, exact: true });
    await otherSelection.check();
    const detail = tab.getByRole('complementary', { name: 'Detalle del escenario seleccionado' });
    const trash = detail.getByRole('button', { name: 'Eliminar escenario', exact: true });

    for (const acceptCount of [0, 1, 2]) {
      const prompts = [];
      const answer = async dialog => {
        prompts.push(dialog.message());
        if (prompts.length <= acceptCount) await dialog.accept();
        else await dialog.dismiss();
      };
      const pending = acceptCount === 2
        ? page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/scenarios/delete-selected'))
        : null;
      page.on('dialog', answer);
      try {
        await trash.click();
      } finally {
        page.off('dialog', answer);
      }
      assert.equal(prompts.length, Math.min(acceptCount + 1, 2));
      assert.ok(prompts[0].includes(cases[1].title) && prompts[0].includes('y sus ejecuciones'));
      if (prompts.length === 2) assert.ok(prompts[1].includes('eliminación definitiva'));
      if (pending) {
        assert.deepEqual((await pending).postDataJSON(), { scenarioIds: [cases[1].id] });
        await expect(page.getByText('Se eliminó 1 escenario.', { exact: true })).toBeVisible();
      } else {
        await expect(tab.getByRole('button', { name: cases[1].title, exact: true })).toBeVisible();
        assert.equal(scenarios.length, 10);
      }
    }
    await expect(otherSelection).toBeChecked();
    await expect(tab.getByRole('button', { name: cases[1].title, exact: true })).toHaveCount(0);
    assert.equal(scenarioRuns.length, 0);

    await page.goto(new URL(`/projects/${projectId}/scenarios/${cases[2].id}`, page.url()).href);
    page.once('dialog', async dialog => {
      assert.match(dialog.message(), /este escenario y sus ejecuciones/);
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Eliminar escenario', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Escenarios (8)', exact: true })).toBeVisible();
    assert.equal(scenarios.some(scenario => scenario.id === cases[2].id), false);
    assert.equal(queuedRequests.length, initialQueues);
  } finally {
    scenarios = saved;
    scenarioRuns = savedRuns;
  }
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.reload();
  console.log('PASS eliminar casos seleccionados actualiza Escenarios, Automatización y Reportes. API simulada.');
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
    await verifyUnifiedOnboarding(page, website);
    await verifyPostmanLoadImport(page, website);
    await verifyDocumentUploads(page);
    await verifyIpaPoints(page);
    await verifyDocumentGenerationConfirmation(page);
    await verifyRequirementClarification(page);
    await verifyQualityScenarios(page);
    await verifyReportEvidence(page);
    await verifyManualEvidenceDialog(page);
    await verifyPrimaryReportTags(page);
    await verifyReportPagination(page);
    await verifyGenerationForBrowserTypes(page);
    await verifyScenarioPagination(page);
    await verifyScenarioPagination(page, true);
    await verifySavedAutomationAfterReload(page);
    await verifyAutomationToolbar(page);
    await verifyWritableExecution(page);
    await verifySuiteProgress(page);
    await verifyAutomationRunStatus(page);
    await verifyStopSuiteDuringSubmission(page);
    await verifyDeleteScenarios(page);
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
    await expect(page.locator('.detail-url code')).toHaveText('https://qa.example.test/');
    await page.getByLabel('Entorno seleccionado').selectOption(environment.id);
    const exportSpec = page.getByRole('button', { name: 'Exportar especificación', exact: true });
    await expect(exportSpec).toHaveCount(0);
    await page.getByRole('tab', { name: 'Historial', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await exportSpec.click();
    const download = await downloadPromise;
    const exportedText = await readFile(await download.path(), 'utf8');
    const exported = JSON.parse(exportedText);
    assert.equal(exported.id, projectId);
    assert.equal(exported.roles[0].permissions[1].allowed, false);
    for (const privateValue of ['secretReference', 'credentialUser', 'synthetic-private', 'hasCredentials']) assert.ok(!exportedText.includes(privateValue));
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    const historyTab = page.getByRole('tab', { name: 'Historial', exact: true });
    await expect(historyTab).toBeFocused();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/#historial$/);
    await page.reload();
    const historyPanel = page.getByRole('tabpanel', { name: 'Historial', exact: true });
    await expect(historyPanel).toBeVisible();
    const versions = historyPanel.getByRole('region', { name: 'Versiones finalizadas', exact: true });
    await expect(versions.getByText('Aún no hay versiones finalizadas registradas.', { exact: true })).toBeVisible();
    const logs = historyPanel.getByRole('region', { name: 'Logs', exact: true });
    await expect(logs.getByText('Creación del proyecto', { exact: true })).toBeVisible();
    await expect(logs.getByText('Última actualización', { exact: true })).toBeVisible();
    await expect(logs.locator('time').nth(0)).toHaveAttribute('datetime', project.createdAt);
    await expect(logs.locator('time').nth(1)).toHaveAttribute('datetime', project.updatedAt);
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    await page.getByRole('link', { name: 'Automatizar con IA', exact: true }).click();
    await page.getByRole('tab', { name: 'Automatización', exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Automatización', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Datos', exact: true }).click();
    const priorSaves = saveCount;
    await page.getByRole('button', { name: 'Editar roles y permisos' }).click();
    const rolesDialog = page.getByRole('dialog', { name: 'Roles y matriz de autorización' });
    await rolesDialog.getByLabel('Nombre del rol').fill('QA actualizado');
    await rolesDialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(rolesDialog).toBeHidden();
    await expect(page.locator('.detail-roles').getByText('QA actualizado', { exact: true })).toBeVisible();
    assert.equal(saveCount, priorSaves + 1, 'El diálogo conserva el proxy de guardado.');
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

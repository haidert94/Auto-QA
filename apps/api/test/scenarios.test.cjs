const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');

const testUrl = process.env.AUTOQA_TEST_DATABASE_URL;
if (!testUrl) throw new Error('Configura AUTOQA_TEST_DATABASE_URL con una base PostgreSQL de pruebas migrada.');

let app;
let prisma;
let baseUrl;
const projectIds = new Set();
const token = randomBytes(32).toString('hex');

before(async () => {
  process.env.DATABASE_URL = testUrl;
  process.env.AUTOQA_LEGACY_MODE = 'true';
  process.env.AUTOQA_DEPLOYMENT = 'local';
  process.env.AUTOQA_DOCUMENTS_TOKEN = token;
  const { createApp } = require('../dist/app');
  prisma = new PrismaClient({ datasourceUrl: testUrl });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  baseUrl = (await app.getUrl()) + '/api';
});

after(async () => {
  try {
    if (prisma && projectIds.size) {
      await prisma.testRun.deleteMany({ where: { projectId: { in: [...projectIds] } } });
      await prisma.project.deleteMany({ where: { id: { in: [...projectIds] } } });
    }
  } finally {
    await Promise.all([prisma?.$disconnect(), app?.close()]);
  }
});

async function makeProject() {
  const projectId = randomUUID();
  await prisma.project.create({
    data: {
      id: projectId,
      name: 'Scenario test ' + projectId.slice(0, 8),
      status: 'READY',
    },
  });
  projectIds.add(projectId);
  return projectId;
}

async function makeRequirement(projectId) {
  const id = randomUUID();
  await prisma.requirement.create({ data: { id, projectId, title: 'Req ' + id.slice(0, 8) } });
  return id;
}

function request(url, options) {
  return fetch(url, { ...options, headers: { ...options?.headers, Authorization: 'Bearer ' + token } });
}

async function post(projectId, body) {
  if (!Object.hasOwn(body, 'requirementId')) body = { ...body, requirementId: await makeRequirement(projectId) };
  return request(`${baseUrl}/projects/${projectId}/scenarios`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
}

test('POST crea un escenario con pasos normalizados', async () => {
  const projectId = await makeProject();
  const response = await post(projectId, {
    title: '  Login válido  ',
    expectedResult: 'Usuario entra al dashboard',
    steps: [
      { ordinal: 3, action: '  Hacer clic en Entrar  ' },
      { ordinal: 1, action: 'Abrir /login' },
      { ordinal: 2, action: 'Escribir credenciales', data: 'usuario@ejemplo.com', expected: 'Campo acepta el valor' },
    ],
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.title, 'Login válido');
  assert.equal(created.expectedResult, 'Usuario entra al dashboard');

  const detail = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}`).then(r => r.json());
  assert.equal(detail.steps.length, 3);
  assert.deepEqual(detail.steps.map(s => s.ordinal), [1, 2, 3]);
  assert.equal(detail.steps[0].action, 'Abrir /login');
  assert.equal(detail.steps[2].action, 'Hacer clic en Entrar');
});

test('la ruta de pasos compartidos sirve el código preparado de su propio proyecto', async () => {
  const projectId = await makeProject();
  const otherProject = await makeProject();
  const create = await post(projectId, {
    title: 'Formulario móvil',
    steps: [
      { ordinal: 1, action: 'fill: #postal-code | 110111' },
      { ordinal: 2, action: 'expect-visible: #summary' },
    ],
  });
  assert.equal(create.status, 201);
  const scenario = await create.json();
  const prefix = baseUrl + '/projects/';
  const prepared = await request(prefix + projectId + '/scenarios/' + scenario.id + '/playwright', { method: 'POST' });
  assert.equal(prepared.status, 201);
  const spec = await prepared.json();
  assert.ok(spec.automationId);
  assert.match(spec.code, /from '\.\/autoqa-steps'/);
  const shared = await request(prefix + projectId + '/scenarios/playwright-steps');
  assert.equal(shared.status, 200);
  const artifact = await shared.json();
  assert.equal(artifact.filename, 'autoqa-steps.ts');
  assert.ok(artifact.code.includes('#postal-code'));
  assert.ok(artifact.code.includes('#summary'));
  assert.ok(!artifact.code.includes('110111'));
  const other = await request(prefix + otherProject + '/scenarios/playwright-steps').then(response => response.json());
  assert.ok(!other.code.includes('#postal-code'));
});

test('POST rechaza un escenario sin historia o requisito asociado', async () => {
  const projectId = await makeProject();
  const result = await post(projectId, { title: 'Sin vínculo', requirementId: null, steps: [{ ordinal: 1, action: 'x' }] });
  assert.equal(result.status, 400);
});

test('POST rechaza título vacío', async () => {
  const projectId = await makeProject();
  const response = await post(projectId, { title: '   ', steps: [{ ordinal: 1, action: 'x' }] });
  assert.equal(response.status, 400);
});

test('POST rechaza más de 50 pasos', async () => {
  const projectId = await makeProject();
  const steps = Array.from({ length: 51 }, (_, i) => ({ ordinal: i + 1, action: 'Paso ' + (i + 1) }));
  const response = await post(projectId, { title: 'Demasiados pasos', steps });
  assert.equal(response.status, 400);
});

test('POST rechaza requirementId de otro proyecto', async () => {
  const projectA = await makeProject();
  const projectB = await makeProject();
  const foreignReq = await makeRequirement(projectB);
  const response = await post(projectA, {
    title: 'Con requisito prestado',
    requirementId: foreignReq,
    steps: [{ ordinal: 1, action: 'x' }],
  });
  assert.equal(response.status, 400);
});

test('POST acepta requirementId del propio proyecto', async () => {
  const projectId = await makeProject();
  const reqId = await makeRequirement(projectId);
  const response = await post(projectId, {
    title: 'Con requisito propio',
    requirementId: reqId,
    steps: [{ ordinal: 1, action: 'x' }],
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.requirementId, reqId);
});

test('GET /requirements lista los requisitos del proyecto', async () => {
  const projectId = await makeProject();
  const reqId = await makeRequirement(projectId);
  const otherProject = await makeProject();
  await makeRequirement(otherProject);

  const list = await request(`${baseUrl}/projects/${projectId}/scenarios/requirements`).then(r => r.json());
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, reqId);
});

test('PATCH actualiza título y reemplaza los pasos completos', async () => {
  const projectId = await makeProject();
  const created = await (await post(projectId, {
    title: 'Original',
    steps: [{ ordinal: 1, action: 'Paso A' }, { ordinal: 2, action: 'Paso B' }],
  })).json();

  const response = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Actualizado', steps: [{ ordinal: 1, action: 'Único paso' }] }),
  });
  assert.equal(response.status, 200);

  const detail = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}`).then(r => r.json());
  assert.equal(detail.title, 'Actualizado');
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0].action, 'Único paso');
});

test('PATCH impide quitar el requisito asociado', async () => {
  const projectId = await makeProject();
  const reqId = await makeRequirement(projectId);
  const created = await (await post(projectId, {
    title: 'Con requisito', requirementId: reqId, steps: [{ ordinal: 1, action: 'x' }],
  })).json();
  assert.equal(created.requirementId, reqId);

  const response = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirementId: null }),
  });
  assert.equal(response.status, 400);

  const detail = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}`).then(r => r.json());
  assert.equal(detail.requirementId, reqId);
});

test('las ejecuciones de un escenario archivado quedan fuera de Reportes y de la exportación', async () => {
  const projectId = await makeProject();
  const created = await (await post(projectId, { title: 'Temporal', steps: [{ ordinal: 1, action: 'x' }] })).json();
  assert.ok(created.id);
  const run = await prisma.testRun.create({
    data: {
      projectId, scenarioId: created.id, status: 'COMPLETED', completedAt: new Date(),
      results: { create: { scenarioId: created.id, status: 'PASSED', durationMs: 42, evidenceKey: 'fixture-trace' } },
    },
  });

  const response = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}`, { method: 'DELETE' });
  assert.equal(response.status, 204);

  const afterDelete = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}`);
  assert.equal(afterDelete.status, 404);
  const list = await request(`${baseUrl}/projects/${projectId}/scenarios`).then(r => r.json());
  assert.deepEqual(list, []);
  const history = await prisma.testRun.findUnique({
    where: { id: run.id }, include: { scenario: true, results: true },
  });
  assert.ok(history.scenario.archivedAt instanceof Date);
  assert.equal(history.scenario.title, 'Temporal');
  assert.equal(history.results[0].evidenceKey, 'fixture-trace');
  const report = await request(`${baseUrl}/projects/${projectId}/runs?view=report`).then(r => r.json());
  assert.deepEqual(report, []);
  const exportResponse = await request(`${baseUrl}/projects/${projectId}/report/export`);
  assert.equal(exportResponse.status, 409);
  const rerun = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environmentId: randomUUID() }),
  });
  assert.equal(rerun.status, 404);
});

test('elimina solo los escenarios seleccionados, sus ejecuciones y sus resultados', async () => {
  const projectId = await makeProject();
  const otherProject = await makeProject();
  const requirementId = await makeRequirement(projectId);
  const scenario = { title: 'Escenario activo', steps: [{ ordinal: 1, action: 'x' }] };
  const selected = await (await post(projectId, { ...scenario, requirementId })).json();
  const keep = await (await post(projectId, scenario)).json();
  const other = await (await post(otherProject, scenario)).json();
  const completedRun = (owner, scenarioId) => prisma.testRun.create({
    data: {
      projectId: owner, scenarioId, status: 'COMPLETED', completedAt: new Date(),
      results: { create: { scenarioId, status: 'PASSED', durationMs: 42, evidenceKey: 'fixture-trace' } },
    },
    include: { results: true },
  });
  const toDelete = await completedRun(projectId, selected.id);
  const retained = await completedRun(projectId, keep.id);
  const elsewhere = await completedRun(otherProject, other.id);
  const environment = await prisma.environment.create({
    data: {
      projectId, type: 'QA', baseUrl: 'https://example.test/', authorizationConfirmed: true, readOnly: true,
      allowedHosts: ['example.test'], allowedPaths: [{ host: 'example.test', path: '/' }],
    },
  });
  const queued = await request(`${baseUrl}/projects/${projectId}/scenarios/${selected.id}/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environmentId: environment.id }),
  });
  assert.equal(queued.status, 201);
  const active = await queued.json();
  assert.equal(active.status, 'QUEUED');
  const olderBatch = await prisma.testRun.create({
    data: {
      projectId, status: 'COMPLETED',
      results: { create: [
        { scenarioId: selected.id, status: 'PASSED' },
        { scenarioId: keep.id, status: 'PASSED' },
      ] },
    },
  });
  const root = `${baseUrl}/projects/${projectId}`;
  const url = root + '/scenarios';
  const remove = body => request(url + '/delete-selected', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const invalid of [{}, { scenarioIds: [] }, { scenarioIds: ['invalid'] }]) {
    assert.equal((await remove(invalid)).status, 400);
  }
  assert.equal((await request(url, { method: 'DELETE' })).status, 404);
  assert.equal((await remove({ scenarioIds: [selected.id, keep.id] })).status, 409);
  assert.equal((await request(url).then(r => r.json())).length, 2);
  assert.ok(await prisma.testRun.findUnique({ where: { id: retained.id } }));
  const stop = await request(root + '/runs/cancel', { method: 'POST' });
  assert.equal(stop.status, 200);
  const selection = { scenarioIds: [selected.id, other.id, selected.id] };
  const response = await remove(selection);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: 1 });
  assert.deepEqual((await request(url).then(r => r.json())).map(item => item.id), [keep.id]);
  assert.equal(await prisma.testScenario.findUnique({ where: { id: selected.id } }), null);
  for (const { id } of [toDelete, active]) {
    assert.equal(await prisma.testRun.findUnique({ where: { id } }), null);
  }
  assert.equal(await prisma.testResult.count({ where: { scenarioId: selected.id } }), 0);
  assert.equal((await request(root + `/runs/${toDelete.id}/trace/${toDelete.results[0].id}`)).status, 404);
  const report = await request(root + '/runs?view=report').then(r => r.json());
  assert.deepEqual(new Set(report.map(run => run.id)), new Set([retained.id, olderBatch.id]));
  assert.equal(report.find(run => run.id === olderBatch.id).results.length, 1);
  assert.ok(await prisma.testRun.findUnique({ where: { id: elsewhere.id } }));
  assert.deepEqual(await (await remove(selection)).json(), { deleted: 0 });
  assert.deepEqual((await request(`${baseUrl}/projects/${otherProject}/scenarios`).then(r => r.json())).map(item => item.id), [other.id]);
  assert.equal((await post(projectId, { ...scenario, requirementId })).status, 201);
  assert.equal((await request(url).then(r => r.json())).length, 2);
});

test('eliminar un proyecto con resultados borra su automatización y conserva los otros proyectos', async () => {
  const projectId = await makeProject();
  const otherProjectId = await makeProject();
  async function executedScenario(owner, legacy) {
    const scenario = await prisma.testScenario.create({
      data: { projectId: owner, title: 'Caso con código guardado', steps: [], automation: { id: randomUUID() } },
    });
    const run = await prisma.testRun.create({
      data: {
        projectId: owner, scenarioId: legacy ? null : scenario.id, status: 'COMPLETED',
        automation: scenario.automation, specText: '// código de prueba',
        results: { create: { scenarioId: scenario.id, status: 'PASSED' } },
      },
      include: { results: true },
    });
    return { scenario, run, result: run.results[0] };
  }

  const removed = [await executedScenario(projectId, false), await executedScenario(projectId, true)];
  const retained = await executedScenario(otherProjectId, false);
  const url = `${baseUrl}/projects/${projectId}`;
  const response = await fetch(url, { method: 'DELETE' });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { id: projectId, removed: true });
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 404);

  for (const { scenario, run, result } of removed) {
    assert.equal(await prisma.testScenario.findUnique({ where: { id: scenario.id } }), null);
    assert.equal(await prisma.testRun.findUnique({ where: { id: run.id } }), null);
    assert.equal(await prisma.testResult.findUnique({ where: { id: result.id } }), null);
  }
  assert.deepEqual((await prisma.testScenario.findUnique({ where: { id: retained.scenario.id } })).automation,
    retained.scenario.automation);
  assert.ok(await prisma.testRun.findUnique({ where: { id: retained.run.id } }));
  assert.ok(await prisma.testResult.findUnique({ where: { id: retained.result.id } }));
});

test('Reportes conserva una fila por escenario aunque un caso acumule más intentos que el límite del historial', async () => {
  const projectId = await makeProject();
  const scenario = { title: 'Inicio de sesión', steps: [{ ordinal: 1, action: 'x' }] };
  const first = await (await post(projectId, scenario)).json();
  const second = await (await post(projectId, scenario)).json();
  const url = `${baseUrl}/projects/${projectId}/runs?view=overview`;
  const old = await prisma.testRun.create({
    data: { projectId, scenarioId: second.id, status: 'COMPLETED', createdAt: new Date(0) },
  });
  await prisma.testRun.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      projectId, scenarioId: first.id, status: 'FAILED', createdAt: new Date((index + 1) * 1000),
    })),
  });
  const retry = await prisma.testRun.create({
    data: { projectId, scenarioId: first.id, status: 'QUEUED', createdAt: new Date(200000) },
  });
  await prisma.testRun.create({
    data: { projectId, scenarioId: second.id, status: 'CANCELED', createdAt: new Date(201000) },
  });
  const getOverview = async () => {
    const response = await request(url);
    assert.equal(response.status, 200);
    return response.json();
  };
  const before = await getOverview();
  assert.equal(before.history.length, 100);
  assert.equal(before.history.some(run => run.id === old.id), false);
  assert.deepEqual(before.latest.map(run => [run.id, run.status]), [[retry.id, 'QUEUED'], [old.id, 'COMPLETED']]);

  await prisma.testRun.update({
    where: { id: retry.id },
    data: { status: 'COMPLETED', results: { create: { scenarioId: first.id, status: 'PASSED' } } },
  });
  const after = await getOverview();
  assert.deepEqual(after.latest.map(run => [run.id, run.status]), [[retry.id, 'COMPLETED'], [old.id, 'COMPLETED']]);
  assert.equal(after.latest[0].results[0].status, 'PASSED');
});

test('GET /scenarios solo lista escenarios del propio proyecto', async () => {
  const projectA = await makeProject();
  const projectB = await makeProject();
  await prisma.testScenario.create({ data: {
    projectId: projectA, title: 'Escenario A', steps: [{ ordinal: 1, action: 'x' }],
    tags: ['@compatibility', '@compatibilidad', '@firefox'],
  } });
  await (await post(projectB, { title: 'Escenario B', steps: [{ ordinal: 1, action: 'x' }] })).json();

  const listA = await request(`${baseUrl}/projects/${projectA}/scenarios`).then(r => r.json());
  assert.equal(listA.length, 1);
  assert.equal(listA[0].title, 'Escenario A');
  assert.deepEqual(listA[0].tags, ['@compatibilidad', '@firefox']);
  const detail = await request(`${baseUrl}/projects/${projectA}/scenarios/${listA[0].id}`).then(r => r.json());
  assert.deepEqual(detail.tags, listA[0].tags);
});

test('ICSP y el informe consolidado cuentan pruebas de calidad vinculadas a requisitos del proyecto', async () => {
  const projectId = await makeProject();
  const otherProject = await makeProject();
  const [availability, lighthouse, load, ux, uncovered, foreign] = await Promise.all([
    ...Array.from({ length: 5 }, () => makeRequirement(projectId)),
    makeRequirement(otherProject),
  ]);
  const source = { projectId, url: 'https://example.test' };
  const recordedAt = new Date(Date.now() - 60_000);
  const completed = { ...source, status: 'COMPLETED', completedAt: recordedAt };
  const [monitor, unexecuted] = await Promise.all([
    prisma.monitor.create({ data: {
      ...source, requirementId: availability, name: 'Monitor en pausa', active: false,
      lastCheckedAt: recordedAt, lastStatus: 'DOWN',
    } }),
    prisma.performanceAudit.create({ data: { ...source, requirementId: lighthouse, status: 'QUEUED' } }),
    prisma.performanceAudit.create({ data: { ...completed, requirementId: lighthouse, performanceScore: 30 } }),
    prisma.loadTest.create({ data: {
      ...completed, requirementId: load, name: 'Carga', stages: [], p95Ms: 250,
    } }),
    prisma.uxAudit.create({ data: { ...completed, requirementId: ux, totalFindings: 0 } }),
    prisma.uxAudit.create({ data: { ...completed, requirementId: foreign, totalFindings: 0 } }),
    prisma.uxAudit.create({ data: { ...completed, totalFindings: 3 } }),
  ]);
  const root = baseUrl + '/projects/' + projectId;
  const response = await request(root + '/icsp');
  assert.equal(response.status, 200);
  const icsp = await response.json();
  assert.deepEqual(icsp.dimensions.map(({ code, numerator, denominator }) => [code, numerator, denominator]), [
    ['requirementsCoverage', 4, 5],
    ['executionCoverage', 4, 5],
    ['stability', 0, 1],
    ['traceability', 4, 5],
  ]);
  assert.deepEqual(icsp.gaps.requirementsWithoutScenario.map(gap => gap.id), [uncovered]);
  assert.deepEqual(icsp.gaps.scenariosNotExecuted.map(gap => gap.id), ['lighthouse:' + unexecuted.id]);
  assert.deepEqual(icsp.counts, { requirements: 5, scenarios: 5, runs: 4, results: 4, passed: 0, failed: 1 });

  // El informe también funciona cuando todas las ejecuciones pertenecen a pruebas de calidad.
  await prisma.performanceAudit.update({ where: { id: unexecuted.id }, data: { status: 'CANCELED' } });
  const exported = await request(root + '/report/export');
  assert.equal(exported.status, 200);
  const report = await exported.json();
  assert.equal(report.icsp.dimensions[0].numerator, 4);
  const scenariosFor = id => report.traceability.find(row => row.requirement.id === id).scenarios;
  assert.deepEqual(scenariosFor(uncovered), []);
  assert.equal(scenariosFor(availability)[0].id, 'availability:' + monitor.id);
  assert.equal(scenariosFor(availability)[0].lastRun.result.status, 'FAILED');
  assert.equal(scenariosFor(load)[0].lastRun.result.status, 'MEASURED');
  assert.equal(scenariosFor(ux)[0].lastRun.result.status, 'MEASURED');
});

test('Escenarios consulta monitores, Lighthouse, carga y UX con pasos en español y resultados del proyecto', async () => {
  const projectId = await makeProject();
  const otherProject = await makeProject();
  const environment = await prisma.environment.create({ data: {
    projectId, type: 'QA', baseUrl: 'https://example.test', allowedHosts: ['example.test'], authorizationConfirmed: true,
  } });
  const requirementId = await makeRequirement(projectId);
  const foreignRequirementId = await makeRequirement(otherProject);
  const run = {
    projectId, requirementId, environmentId: environment.id, url: 'https://example.test/catalogo',
    startedAt: new Date('2026-11-23T12:00:00Z'), completedAt: new Date('2026-11-23T12:00:02Z'),
    status: 'COMPLETED',
  };
  const [monitor, audit, load, ux] = await Promise.all([
    prisma.monitor.create({ data: {
      projectId, requirementId, environmentId: environment.id, name: 'Disponibilidad del catálogo', url: run.url + '?credencial=valor-de-prueba#secreto',
      timeoutMs: 7000, intervalMinutes: 12, lastStatus: 'UP', lastHttpStatus: 204, lastCheckedAt: run.completedAt, lastLatencyMs: 86,
    } }),
    prisma.performanceAudit.create({ data: { ...run, performanceScore: 94 } }),
    prisma.loadTest.create({ data: {
      ...run, name: 'Carga del catálogo', stages: [{ duration: '15s', target: 2 }], totalRequests: 80, p95Ms: 250, failRate: 0,
    } }),
    prisma.uxAudit.create({ data: { ...run, totalFindings: 2, criticalCount: 1 } }),
    prisma.monitor.create({ data: { projectId: otherProject, name: 'Monitor ajeno', url: run.url } }),
  ]);
  const legacy = { ...run, requirementId: null };
  const [legacyMonitor, legacyAudit, legacyLoad, legacyUx, wronglyLinked] = await Promise.all([
    prisma.monitor.create({ data: {
      projectId, name: 'Monitor anterior', url: run.url, lastStatus: 'UP', lastCheckedAt: run.completedAt,
    } }),
    prisma.performanceAudit.create({ data: legacy }),
    prisma.loadTest.create({ data: { ...legacy, name: 'Carga anterior', stages: [] } }),
    prisma.uxAudit.create({ data: legacy }),
    prisma.uxAudit.create({ data: { ...run, requirementId: foreignRequirementId } }),
  ]);
  const root = `${baseUrl}/projects/${projectId}/scenarios`;
  const response = await request(root + '/quality');
  assert.equal(response.status, 200);
  const cards = await response.json();
  assert.equal(cards.length, 4);
  assert.ok(cards.every(card => card.requirementId === requirementId));
  const byResource = new Map(cards.map(card => [card.quality.resourceId, card]));
  const historical = await (await request(`${baseUrl}/projects/${projectId}/report/quality`)).json();
  for (const record of [legacyMonitor, legacyAudit, legacyLoad, legacyUx, wronglyLinked]) {
    assert.ok(!byResource.has(record.id));
    assert.ok(historical.some(item => item.id === record.id));
  }
  assert.deepEqual(byResource.get(monitor.id).tags, ['@disponibilidad']);
  assert.equal(byResource.get(monitor.id).quality.status.label, 'Disponible');
  assert.equal(byResource.get(monitor.id).quality.result, 'Última respuesta HTTP 204.');
  assert.doesNotMatch(JSON.stringify(cards), /valor-de-prueba|Monitor ajeno/);
  assert.deepEqual(byResource.get(audit.id).tags, ['@performance', '@lighthouse']);
  assert.equal(byResource.get(audit.id).quality.status.label, 'Finalizada');
  assert.equal(byResource.get(audit.id).quality.durationMs, 2000);
  assert.deepEqual(byResource.get(load.id).tags, ['@performance', '@carga']);
  assert.match(byResource.get(load.id).quality.result, /250 ms/);
  assert.deepEqual(byResource.get(ux.id).tags, ['@ux']);
  assert.match(byResource.get(ux.id).quality.result, /2 hallazgos registrados/);
  const params = (id, label) => byResource.get(id).quality.executionConfig.parameters.find(field => field.label === label)?.value;
  assert.equal(params(monitor.id, 'Intervalo del monitor'), '12 min');
  assert.equal(params(monitor.id, 'Tiempo máximo de respuesta'), '7000 ms');
  assert.match(params(audit.id, 'Categorías'), /Rendimiento, Accesibilidad/);
  assert.equal(params(load.id, 'Etapa 1'), '15s · 2 usuarios virtuales');
  assert.equal(params(load.id, 'Tiempo de respuesta (p95)'), 'Menor a 2000 ms');
  assert.match(params(ux.id, 'Análisis'), /Nielsen.*WCAG/);
  for (const card of cards) {
    assert.equal(card.quality.executionConfig.environmentId, environment.id);
    assert.equal(card.quality.executionConfig.url, run.url);
    assert.deepEqual(card.steps.map(step => step.action.split(' ', 1)[0]), ['Dado', 'Cuando', 'Entonces']);
    assert.ok(card.expectedResult);
    assert.equal(card.quality.hasResult, true);
  }
  assert.deepEqual(await (await request(root)).json(), []);

  const templates = [
    [monitor, 'availability', 'disponibilidad.mjs', /fetch\(target/, /AUTOQA_TARGET_QUERY/],
    [audit, 'lighthouse', 'lighthouse.mjs', /lighthouse\(target.href/, /lighthouse-report\.json/],
    [load, 'load', 'carga.k6.js', /k6\/http/, /duration: '15s', target: 2/],
    [ux, 'ux', 'evidencias-ux.mjs', /page\.evaluate/, /Nielsen y pautas WCAG/],
  ];
  for (const [resource, kind, name, runner, config] of templates) {
    const path = root + '/quality/' + kind + '/' + resource.id + '/automation';
    const wrongProject = `${baseUrl}/projects/${otherProject}/scenarios/quality/${kind}/${resource.id}/automation`;
    assert.equal((await request(wrongProject, { method: 'POST' })).status, 404);
    assert.equal((await request(path)).status, 404);
    assert.equal(byResource.get(resource.id).quality.automation.prepared, false);
    const response = await request(path, { method: 'POST' });
    assert.equal(response.status, 200);
    const prepared = await response.json();
    assert.equal(prepared.filename, name);
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.code, undefined);
    assert.equal((await request(path, { method: 'POST' })).status, 200);
    const saved = await (await request(path)).json();
    assert.equal(saved.filename, name);
    assert.match(saved.code, runner);
    assert.match(saved.code, config);
    assert.doesNotMatch(saved.code, /valor-de-prueba/);
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: saved.code, encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  const savedCards = await (await request(root + '/quality')).json();
  assert.deepEqual(savedCards.map(card => card.quality.automation.prepared), [true, true, true, true]);
  assert.deepEqual(savedCards.map(card => card.quality.status), cards.map(card => card.quality.status));
  assert.equal(await prisma.testRun.count({ where: { projectId } }), 0);

  await prisma.monitor.update({ where: { id: monitor.id }, data: { timeoutMs: 3200 } });
  const changed = await (await request(root + '/quality')).json();
  assert.equal(changed.find(card => card.quality.kind === 'availability').quality.automation.prepared, false);
  const monitorPath = root + '/quality/availability/' + monitor.id + '/automation';
  assert.equal((await request(monitorPath)).status, 404);
  assert.equal((await request(monitorPath, { method: 'POST' })).status, 200);
  assert.match((await (await request(monitorPath)).json()).code, /AbortSignal\.timeout\(3200\)/);
});

test('los agentes conservan el archivo, rechazan planes inválidos y permiten corregir la configuración', async () => {
  const projectId = await makeProject();
  const environment = await prisma.environment.create({ data: {
    projectId, type: 'QA', baseUrl: 'https://example.test', allowedHosts: ['example.test'],
    allowedPaths: ['/checkout'], authorizationConfirmed: true,
  } });
  const requirementId = await makeRequirement(projectId);
  const source = { projectId, requirementId, environmentId: environment.id, url: 'https://example.test/checkout?token=fixture-private' };
  const [ux, load, audit, wrongTarget] = await Promise.all([
    prisma.uxAudit.create({ data: { ...source, status: 'COMPLETED' } }),
    prisma.loadTest.create({ data: { ...source, name: 'Carga', stages: [{ duration: '5s', target: 2 }], status: 'COMPLETED' } }),
    prisma.performanceAudit.create({ data: {
      ...source, status: 'COMPLETED',
      automationSignature: createHash('sha256').update(JSON.stringify([1, 'lighthouse', source.url, undefined, undefined])).digest('hex'),
    } }),
    prisma.performanceAudit.create({ data: { ...source, url: 'https://example.test/fuera', status: 'COMPLETED' } }),
  ]);
  const root = `${baseUrl}/projects/${projectId}/scenarios/quality`;
  const path = (kind, resource) => root + '/' + kind + '/' + resource.id + '/automation';
  const prepare = async (kind, resource) => {
    const response = await request(path(kind, resource), { method: 'POST' });
    assert.equal(response.status, 200);
    return response.json();
  };
  const { AppModule } = require('../dist/module');
  const ai = app.select(AppModule).get(require('../dist/ai/ai-router').AiRouter, { strict: true });
  const dispatch = ai.dispatch;
  let requests = 0;
  let checks = ['no-permitido'];
  ai.dispatch = async context => {
    requests++;
    assert.equal(context.operation, 'ux-analysis');
    assert.equal(context.projectId, projectId);
    assert.doesNotMatch(context.prompt, /example\.test|fixture-private/);
    assert.match(context.prompt, /Tipo de página: Formulario/);
    await new Promise(resolve => setTimeout(resolve, 50));
    return { text: JSON.stringify({ checks }), usedFallback: false };
  };

  try {
    const [uxReview, loadReview, blocked] = await Promise.all([
      prepare('ux', ux), prepare('load', load), prepare('lighthouse', wrongTarget),
    ]);
    assert.equal(uxReview.prepared, false);
    assert.match(uxReview.reviewReason, /comprobaciones válidas/);
    assert.match(loadReview.reviewReason, /10 segundos a 30 minutos/);
    assert.match(blocked.reviewReason, /fuera del alcance autorizado/);
    const invalid = await (await request(root)).json();
    assert.equal(invalid.filter(card => card.quality.automation.reviewReason).length, 3);
    assert.equal((await request(path('ux', ux))).status, 404);
    assert.equal((await request(path('lighthouse', audit))).status, 200, 'se conservan las automatizaciones anteriores autorizadas');

    checks = ['form-labels', 'page-language', 'form-labels'];
    await prisma.loadTest.update({ where: { id: load.id }, data: { stages: [{ duration: '16s', target: 3 }] } });
    const prepared = await Promise.all([prepare('ux', ux), prepare('ux', ux), prepare('load', load)]);
    assert.equal(prepared.every(item => item.prepared && !item.reviewReason), true);
    assert.equal(requests, 2, 'una revisión y una sola preparación para las dos solicitudes concurrentes');
    const stored = await prisma.uxAudit.findUnique({ where: { id: ux.id } });
    const saved = await (await request(path('ux', ux))).json();
    assert.equal(saved.code, stored.automationCode);
    assert.match(saved.code, /\["form-labels","page-language"\]/);
    assert.match(saved.code, /ux-comprobaciones\.json/);
    assert.doesNotMatch(saved.code, /fixture-private|no-permitido/);
    assert.equal(requests, 2, 'la descarga reutiliza el archivo guardado');
    assert.equal(await prisma.testRun.count({ where: { projectId } }), 0);
    assert.equal(stored.status, 'COMPLETED');

    await prisma.environment.update({ where: { id: environment.id }, data: { allowedPaths: ['/otro'] } });
    assert.equal((await request(path('ux', ux))).status, 404);
    assert.equal((await request(path('lighthouse', audit))).status, 404);
  } finally {
    ai.dispatch = dispatch;
  }
});

test('la suite encola los cuatro tipos de calidad sobre los registros existentes y permite detenerlos', async () => {
  const projectId = await makeProject();
  const otherProject = await makeProject();
  const environment = await prisma.environment.create({ data: {
    projectId, type: 'QA', baseUrl: 'https://example.test', allowedHosts: ['example.test'],
    allowedPaths: [{ host: 'example.test', path: '/catalogo' }], authorizationConfirmed: true, readOnly: true,
  } });
  const source = { projectId, environmentId: environment.id, url: 'https://example.test/catalogo' };
  const stages = [{ duration: '10s', target: 2 }];
  const signature = (kind, timeout, stageList) => createHash('sha256')
    .update(JSON.stringify([1, kind, source.url, timeout, stageList])).digest('hex');
  const [monitor, audit, load, ux] = await Promise.all([
    prisma.monitor.create({ data: { ...source, name: 'Monitor de la suite', active: false,
      timeoutMs: 5000, automationSignature: signature('availability', 5000) } }),
    prisma.performanceAudit.create({ data: { ...source, status: 'COMPLETED', automationSignature: signature('lighthouse'),
      performanceScore: 90 } }),
    prisma.loadTest.create({ data: { ...source, status: 'FAILED', name: 'Carga de la suite', stages } }),
    prisma.uxAudit.create({ data: { ...source, status: 'COMPLETED', automationSignature: signature('ux') } }),
  ]);
  const root = baseUrl + '/projects/' + projectId;
  const loadAutomation = await request(root + '/scenarios/quality/load/' + load.id + '/automation', { method: 'POST' });
  assert.equal((await loadAutomation.json()).prepared, true);
  const paths = Object.entries({ availability: monitor, lighthouse: audit, load, ux }).map(([kind, row]) => (
    '/scenarios/quality/' + kind + '/' + row.id + '/executions/' + randomUUID()
  ));
  for (const path of paths) {
    const queued = await request(root + path, { method: 'POST' });
    assert.equal(queued.status, 201, path + ' ' + await queued.clone().text());
    assert.equal((await queued.json()).status, 'QUEUED');
    assert.equal((await (await request(root + path, { method: 'POST' })).json()).status, 'QUEUED', 'Repetir la solicitud conserva el intento');
    assert.equal((await request(baseUrl + '/projects/' + otherProject + path, { method: 'POST' })).status, 404);
  }
  assert.equal(await prisma.performanceAudit.count({ where: { projectId } }), 1);
  assert.equal((await prisma.performanceAudit.findUnique({ where: { id: audit.id } })).performanceScore, null);
  assert.equal(await prisma.monitorCheck.count({ where: { monitorId: monitor.id } }), 1);
  const activity = await (await request(root + '/runs/activity')).json();
  assert.equal(activity.queued, 4);
  assert.equal((await request(root + '/report/export')).status, 409);
  assert.equal((await request(root + '/runs/cancel', { method: 'POST' })).status, 200);
  for (const path of paths) assert.equal((await (await request(root + path)).json()).status, 'CANCELED');
  const records = await (await request(root + '/report/quality')).json();
  assert.deepEqual(records, []);
  assert.equal((await prisma.monitor.findUnique({ where: { id: monitor.id } })).active, false);
  await prisma.environment.update({ where: { id: environment.id }, data: {
    allowedPaths: [{ host: 'example.test', path: '/otro' }],
  } });
  const newAttempt = paths[0].replace(/[^/]+$/, randomUUID());
  assert.equal((await request(root + newAttempt, { method: 'POST' })).status, 400);
  assert.equal(await prisma.monitorCheck.count({ where: { monitorId: monitor.id } }), 1);
});

test('Reportes consulta notas y capturas manuales con el alcance del resultado', async () => {
  const projectId = await makeProject();
  const otherProject = await makeProject();
  const create = await post(projectId, { title: 'Escenario con evidencia manual', steps: [{ ordinal: 1, action: 'Verificar la página' }], tags: ['@manual'] });
  const scenario = await create.json();
  const run = await prisma.testRun.create({ data: {
    projectId, scenarioId: scenario.id, status: 'COMPLETED', targetProvider: 'manual',
  } });
  const result = await prisma.testResult.create({ data: {
    runId: run.id, scenarioId: scenario.id, status: 'PASSED',
    evidence: { manual: true, notes: 'La página muestra la confirmación en QA.', screenshots: [
      { filename: 'confirmacion.png', data: 'data:image/png;base64,iVBORw0KGgo=' },
      { filename: 'ignorar.svg', data: 'data:image/svg+xml;base64,PHN2Zz4=' },
    ] },
  } });
  const path = '/runs/' + run.id + '/results/' + result.id + '/evidence';
  const response = await request(baseUrl + '/projects/' + projectId + path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).manual, {
    notes: 'La página muestra la confirmación en QA.',
    screenshots: [{ filename: 'confirmacion.png', data: 'data:image/png;base64,iVBORw0KGgo=' }],
  });
  assert.equal((await request(baseUrl + '/projects/' + otherProject + path)).status, 404);
});

test('Reportes reúne resultados finalizados y evidencia UX del proyecto', async () => {
  const projectId = await makeProject();
  const otherProjectId = await makeProject();
  const auditKey = randomBytes(16).toString('hex');
  const screenshotKey = randomBytes(16).toString('hex');
  const url = 'https://example.test/catalogo?token=privado-fixture#credencial';
  const timestamp = new Date('2026-11-23T12:00:00Z');
  const completed = { projectId, url, status: 'COMPLETED', completedAt: timestamp };
  const [monitor, , , ux, otherUx, storedUx] = await Promise.all([
    prisma.monitor.create({ data: {
      projectId, name: 'Monitor pausado', url, active: false, lastCheckedAt: timestamp, lastStatus: 'UP',
      lastLatencyMs: 0, lastHttpStatus: 204,
      checks: { create: { at: timestamp, status: 'UP', httpStatus: 204, latencyMs: 0 } },
    } }),
    prisma.performanceAudit.create({ data: { ...completed, performanceScore: 94, accessibilityScore: 0, tbtMs: 0 } }),
    prisma.loadTest.create({ data: { ...completed, name: 'Carga registrada', stages: [], failRate: 0, p95Ms: 250 } }),
    prisma.uxAudit.create({ data: { ...completed, totalFindings: 1, criticalCount: 0, reportKey: auditKey } }),
    prisma.uxAudit.create({ data: { ...completed, projectId: otherProjectId, reportKey: auditKey } }),
    prisma.uxAudit.create({ data: { ...completed, screenshotKey, reportDetails: {
      overallSummary: 'Auditoría en PostgreSQL',
      findings: [{ severity: 'minor', summary: 'Mejorar la etiqueta', recommendation: 'Agregar contexto visible' }],
    } } }),
    prisma.performanceAudit.create({ data: { ...completed, status: 'RUNNING', performanceScore: 99 } }),
    prisma.loadTest.create({ data: { ...completed, name: 'Carga cancelada', status: 'CANCELED', stages: [] } }),
  ]);
  const { AppModule } = require('../dist/module');
  const { SCREENSHOT_READER } = require('../dist/exploration/screenshot-storage');
  const reader = app.select(AppModule).get(SCREENSHOT_READER, { strict: false });
  const read = reader.read;
  reader.read = async function (key) {
    if (key === auditKey) return Buffer.from(JSON.stringify({
      overallSummary: 'Resumen de la auditoría', screenshotKey, findings: [
        { severity: 'major', summary: 'Campo sin etiqueta', recommendation: 'Añadir una etiqueta visible', selector: 'input' },
      ],
    }));
    if (key === screenshotKey) return Buffer.from([137, 80, 78, 71]);
    return read.call(this, key);
  };
  const base = `${baseUrl}/projects/${projectId}/report/quality`;
  try {
    const response = await request(base);
    assert.equal(response.status, 200);
    const data = await response.json();
    const byKind = new Map(data.map(row => [row.kind, row]));
    assert.equal(data.length, 5);
    assert.equal(data.find(row => row.id === storedUx.id).hasEvidence, true);
    assert.equal(byKind.get('availability').status, 'available');
    assert.deepEqual(byKind.get('availability').metrics, [{ label: 'Código HTTP', value: '204' }, { label: 'Latencia', value: '0 ms' }]);
    assert.ok(byKind.get('lighthouse').metrics.some(metric => metric.value === '0/100'));
    assert.ok(byKind.get('load').metrics.some(metric => metric.label === 'Tiempo de respuesta p95' && metric.value === '250 ms'));
    assert.doesNotMatch(JSON.stringify(data), new RegExp(['privado-fixture', 'credencial', 'Carga cancelada', auditKey, otherUx.id].join('|')));
    const history = await (await request(base + '/availability/' + monitor.id)).json();
    assert.equal(history[0].httpStatus, 204);
    const detail = await (await request(base + '/ux/' + ux.id)).json();
    assert.deepEqual(detail, { summary: 'Resumen de la auditoría', hasScreenshot: true,
      findings: [{ severity: 'major', summary: 'Campo sin etiqueta', recommendation: 'Añadir una etiqueta visible' }] });
    const screenshot = await request(base + '/ux/' + ux.id + '/screenshot');
    assert.equal(screenshot.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await screenshot.arrayBuffer())], [137, 80, 78, 71]);
    const stored = await (await request(base + '/ux/' + storedUx.id)).json();
    assert.deepEqual(stored, { summary: 'Auditoría en PostgreSQL', hasScreenshot: true,
      findings: [{ severity: 'minor', summary: 'Mejorar la etiqueta', recommendation: 'Agregar contexto visible' }] });
    const storedScreenshot = await request(base + '/ux/' + storedUx.id + '/screenshot');
    assert.equal(storedScreenshot.status, 200);
    assert.deepEqual([...new Uint8Array(await storedScreenshot.arrayBuffer())], [137, 80, 78, 71]);
    assert.equal((await request(base + '/ux/' + otherUx.id)).status, 404);
    assert.equal((await request(base + '/ux/' + otherUx.id + '/screenshot')).status, 404);
  } finally {
    reader.read = read;
  }
});

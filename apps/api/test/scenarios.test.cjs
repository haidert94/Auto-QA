const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
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

test('PATCH desconecta el requisito cuando se envía null', async () => {
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
  assert.equal(response.status, 200);

  const detail = await request(`${baseUrl}/projects/${projectId}/scenarios/${created.id}`).then(r => r.json());
  assert.equal(detail.requirementId, null);
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
  await (await post(projectA, { title: 'Escenario A', steps: [{ ordinal: 1, action: 'x' }] })).json();
  await (await post(projectB, { title: 'Escenario B', steps: [{ ordinal: 1, action: 'x' }] })).json();

  const listA = await request(`${baseUrl}/projects/${projectA}/scenarios`).then(r => r.json());
  assert.equal(listA.length, 1);
  assert.equal(listA[0].title, 'Escenario A');
});

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');

const testUrl = process.env.AUTOQA_TEST_DATABASE_URL;
if (!testUrl) throw new Error('Configura AUTOQA_TEST_DATABASE_URL con una base PostgreSQL de pruebas migrada.');

let app;
let prisma;
let baseUrl;
const projectIds = new Set();

before(async () => {
  process.env.DATABASE_URL = testUrl;
  process.env.AUTOQA_LEGACY_MODE = 'true';
  const { createApp } = require('../dist/app');
  prisma = new PrismaClient({ datasourceUrl: testUrl });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  baseUrl = (await app.getUrl()) + '/api';
});

after(async () => {
  try {
    if (prisma && projectIds.size) {
      await prisma.project.deleteMany({ where: { id: { in: [...projectIds] } } });
    }
  } finally {
    await Promise.all([prisma?.$disconnect(), app?.close()]);
  }
});

async function makeProject(allowedHosts = ['example.com'], options = {}) {
  const projectId = randomUUID();
  const envId = randomUUID();
  await prisma.project.create({
    data: {
      id: projectId,
      name: 'Exploration test ' + projectId.slice(0, 8),
      status: 'READY',
      environments: {
        create: {
          id: envId,
          type: 'QA',
          baseUrl: 'https://' + allowedHosts[0],
          accessMode: 'PUBLIC',
          authorizationConfirmed: options.authorized ?? true,
          authorizedAt: options.authorized === false ? null : new Date(),
          allowedHosts,
          allowedPaths: options.allowedPaths ?? [],
          excludedPaths: options.excludedPaths ?? [],
          readOnly: options.readOnly ?? true,
        },
      },
    },
  });
  projectIds.add(projectId);
  return { projectId, envId };
}

async function post(projectId, body) {
  return fetch(`${baseUrl}/projects/${projectId}/explorations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}

test('POST encola una exploración válida y la expone en GET', async () => {
  const { projectId, envId } = await makeProject(['example.com']);
  const response = await post(projectId, { environmentId: envId, startUrl: 'https://example.com/landing' });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.status, 'QUEUED');
  assert.equal(created.environmentId, envId);
  assert.equal(created.startUrl, 'https://example.com/landing');
  assert.ok(typeof created.id === 'string' && created.id.length > 0);

  const list = await fetch(`${baseUrl}/projects/${projectId}/explorations`).then(r => r.json());
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);

  const detail = await fetch(`${baseUrl}/projects/${projectId}/explorations/${created.id}`).then(r => r.json());
  assert.equal(detail.pages.length, 0);
  assert.equal(detail.logs.length, 0);
});

test('POST rechaza una URL fuera del allowlist del entorno', async () => {
  const { projectId, envId } = await makeProject(['example.com']);
  const response = await post(projectId, { environmentId: envId, startUrl: 'https://evil.com/' });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.issue, 'host-not-in-allowlist');
});

test('POST rechaza una URL con esquema no HTTP(S)', async () => {
  const { projectId, envId } = await makeProject(['example.com']);
  const response = await post(projectId, { environmentId: envId, startUrl: 'file:///etc/passwd' });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.issue, 'disallowed-protocol');
});

test('POST rechaza una URL con credenciales', async () => {
  const { projectId, envId } = await makeProject(['example.com']);
  const response = await post(projectId, { environmentId: envId, startUrl: 'https://admin:secret@example.com/' });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.issue, 'credentials-in-url');
});

test('POST rechaza IP literal y metadata de nube', async () => {
  const { projectId, envId } = await makeProject(['example.com']);
  const result1 = await post(projectId, { environmentId: envId, startUrl: 'http://127.0.0.1/' });
  assert.equal(result1.status, 400);
  assert.equal((await result1.json()).issue, 'ip-literal');

  const result2 = await post(projectId, { environmentId: envId, startUrl: 'http://169.254.169.254/latest/meta-data/' });
  assert.equal(result2.status, 400);
  assert.equal((await result2.json()).issue, 'ip-literal');
});

test('POST exige entorno autorizado', async () => {
  const { projectId, envId } = await makeProject(['example.com'], { authorized: false });
  const response = await post(projectId, { environmentId: envId, startUrl: 'https://example.com/' });
  assert.equal(response.status, 400);
});

test('POST exige entorno readOnly', async () => {
  const { projectId, envId } = await makeProject(['example.com'], { readOnly: false });
  const response = await post(projectId, { environmentId: envId, startUrl: 'https://example.com/' });
  assert.equal(response.status, 400);
});

test('POST rechaza un environmentId que no pertenece al proyecto', async () => {
  const { projectId } = await makeProject(['example.com']);
  const other = await makeProject(['other.com']);
  const response = await post(projectId, { environmentId: other.envId, startUrl: 'https://example.com/' });
  assert.equal(response.status, 404);
});

test('POST respeta allowedPaths y excludedPaths del entorno', async () => {
  const { projectId, envId } = await makeProject(['example.com'], {
    allowedPaths: ['/app'],
    excludedPaths: ['/app/admin'],
  });
  const ok = await post(projectId, { environmentId: envId, startUrl: 'https://example.com/app/home' });
  assert.equal(ok.status, 201);

  const outside = await post(projectId, { environmentId: envId, startUrl: 'https://example.com/other' });
  assert.equal(outside.status, 400);
  assert.equal((await outside.json()).issue, 'path-not-allowed');

  const excluded = await post(projectId, { environmentId: envId, startUrl: 'https://example.com/app/admin/users' });
  assert.equal(excluded.status, 400);
  assert.equal((await excluded.json()).issue, 'path-excluded');
});

test('GET de un proyecto inexistente devuelve 404', async () => {
  const response = await fetch(`${baseUrl}/projects/${randomUUID()}/explorations`);
  assert.equal(response.status, 404);
});

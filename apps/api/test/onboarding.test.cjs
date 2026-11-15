const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');

const testUrl = process.env.AUTOQA_TEST_DATABASE_URL;
if (!testUrl) throw new Error('Configura AUTOQA_TEST_DATABASE_URL con una base PostgreSQL de pruebas migrada.');

let app;
let prisma;
let endpoint;
const projectIds = new Set();

before(async () => {
  process.env.DATABASE_URL = testUrl;
  process.env.AUTOQA_LEGACY_MODE = 'true';
  const { createApp } = require('../dist/app');
  prisma = new PrismaClient({ datasourceUrl: testUrl });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  endpoint = (await app.getUrl()) + '/api/projects';
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

async function request(method, body, id = '') {
  const response = await fetch(endpoint + (id ? '/' + id : ''), {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (method === 'POST' && response.status === 201) projectIds.add(data.id);
  return { status: response.status, data };
}

function configuration() {
  return {
    name: 'Portal sintético',
    description: 'Registro de integración',
    ownerLabel: 'Equipo QA',
    status: 'READY',
    priorityModules: ['Catálogo'],
    environments: [
      {
        type: 'QA',
        baseUrl: 'https://QA.example.com/catalogo',
        accessMode: 'PRIVATE',
        authorizationConfirmed: true,
        allowedHosts: ['QA.example.com', 'assets.example.com'],
        allowedPaths: [
          { host: 'qa.example.com', path: '/catalogo/' },
          { host: 'assets.example.com', path: '/' },
        ],
        excludedPaths: [{ host: 'qa.example.com', path: '/catalogo/pagos' }],
        prohibitedActions: ['Comprar', 'Borrar'],
        testData: {
          syntheticData: 'Catálogo de prueba',
          seeds: 'Carga inicial',
          cleanupStrategy: 'Restaurar datos',
          integrations: ['Pasarela simulada'],
        },
      },
      {
        type: 'STAGING',
        baseUrl: 'https://staging.example.com/',
        accessMode: 'SSO',
        authorizationConfirmed: true,
        allowedHosts: ['staging.example.com'],
        allowedPaths: [{ host: 'staging.example.com', path: '/' }],
      },
    ],
    roles: [{
      name: 'Lector',
      description: 'Cuenta sintética',
      secretReference: 'vault:qa/lector',
      permissions: [
        { resource: 'Catálogo', action: 'Ver', allowed: true },
        { resource: 'Catálogo', action: 'Borrar', allowed: false },
      ],
    }],
    executionSettings: {
      browser: 'FIREFOX', frequency: 'Semanal', maxPages: 10, maxDurationSeconds: 30,
      maxConcurrency: 1, requestsPerMinute: 20, notifications: 'Equipo QA',
    },
  };
}

test('draft can be resumed and completed with multiple environments and role permissions', async () => {
  const draft = await request('POST', { name: ' Portal inicial ', environments: [{ type: 'QA' }] });
  assert.equal(draft.status, 201);
  assert.equal(draft.data.name, 'Portal inicial');
  assert.equal(draft.data.status, 'DRAFT');
  assert.equal(draft.data.environments[0].readOnly, true);
  assert.ok(draft.data.missingRequirements.some(message => message.includes('autorización')));
  const invalid = await request('PUT', { name: 'Cambio inválido', revision: 0, status: 'READY' }, draft.data.id);
  assert.equal(invalid.status, 400);
  const unchanged = await request('GET', undefined, draft.data.id);
  assert.equal(unchanged.data.revision, 0);
  assert.equal(unchanged.data.name, 'Portal inicial');

  const payload = configuration();
  payload.environments[0].id = draft.data.environments[0].id;
  const completed = await request('PUT', { ...payload, revision: 0 }, draft.data.id);
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  const persisted = await request('GET', undefined, draft.data.id);
  assert.equal(persisted.status, 200);
  const project = persisted.data;
  assert.ok(Array.isArray(project.documents));
  assert.equal(project.status, 'READY');
  assert.equal(project.revision, 1);
  assert.deepEqual(project.missingRequirements, []);
  assert.deepEqual(project.priorityModules, ['Catálogo']);
  assert.equal(project.ownerLabel, payload.ownerLabel);
  assert.equal(project.authorizationConfirmed, true);
  assert.equal(project.environments.length, 2);
  assert.equal(project.environments[0].id, draft.data.environments[0].id);
  assert.equal(project.environments[0].baseUrl, 'https://qa.example.com/catalogo');
  assert.equal(project.environments[1].accessMode, 'SSO');
  assert.ok(project.environments.every(environment => environment.authorizationConfirmed && environment.authorizedAt));
  assert.deepEqual(project.environments[0].allowedHosts, ['qa.example.com', 'assets.example.com']);
  assert.deepEqual(project.environments[0].allowedPaths[0], { host: 'qa.example.com', path: '/catalogo' });
  assert.deepEqual(project.environments[0].excludedPaths, payload.environments[0].excludedPaths);
  assert.deepEqual(project.environments[0].prohibitedActions, ['Comprar', 'Borrar']);
  assert.deepEqual(project.environments[0].testData, payload.environments[0].testData);
  assert.deepEqual(project.executionSettings, payload.executionSettings);
  assert.equal(project.roles[0].secretReference, 'vault:qa/lector');
  assert.deepEqual(project.roles[0].permissions, payload.roles[0].permissions);
  assert.ok((await request('GET')).data.some(item => item.id === project.id && item.environments.length === 2));

  payload.environments[1].id = project.environments[1].id;
  const retained = await request('PUT', { ...payload, revision: 1 }, project.id);
  assert.equal(retained.status, 200);
  assert.equal(retained.data.roles[0].id, project.roles[0].id);
  assert.equal(retained.data.environments[0].authorizedAt, project.environments[0].authorizedAt);
  assert.equal((await request('PUT', { ...payload, revision: 1 }, project.id)).status, 409);
  const changed = await request('PUT', {
    ...payload,
    status: 'DRAFT',
    revision: 2,
    roles: [],
    environments: [{ ...payload.environments[0], authorizationConfirmed: false }],
  }, project.id);
  assert.equal(changed.status, 200);
  assert.equal(changed.data.authorizationConfirmed, false);
  assert.equal(changed.data.authorizedAt, null);
  assert.equal(changed.data.environments.length, 1);
  assert.equal(changed.data.environments[0].authorizedAt, null);
  assert.deepEqual(changed.data.roles, []);
});

test('starter request remains supported as a draft, and missing IDs return 404', async () => {
  const legacyPayload = {
    name: 'Starter', baseUrl: 'https://example.com', environment: 'QA', authorizationConfirmed: true, readOnly: false,
  };
  const project = await request('POST', legacyPayload);
  assert.equal(project.status, 201, JSON.stringify(project.data));
  assert.equal(project.data.status, 'DRAFT');
  assert.equal(project.data.environments[0].readOnly, false);
  assert.ok(project.data.environments[0].authorizedAt);
  assert.deepEqual(project.data.environments[0].allowedPaths, []);
  assert.equal((await request('POST', { ...legacyPayload, authorizationConfirmed: false })).status, 400);
  assert.equal((await request('GET', undefined, randomUUID())).status, 404);
  assert.equal((await request('PUT', { revision: 0, name: 'Inexistente' }, randomUUID())).status, 404);
});

test('public mode can complete without roles, and concurrent writes share a single revision', async () => {
  const payload = configuration();
  payload.environments = [{ ...payload.environments[0], accessMode: 'PUBLIC' }];
  payload.roles = [];
  const created = await request('POST', payload);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  payload.environments[0].id = created.data.environments[0].id;
  const results = await Promise.all([
    request('PUT', { ...payload, revision: 0, name: 'Primera edición' }, created.data.id),
    request('PUT', { ...payload, revision: 0, name: 'Segunda edición' }, created.data.id),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = await request('GET', undefined, created.data.id);
  assert.equal(saved.data.revision, 1);
  assert.equal(saved.data.name, results.find(result => result.status === 200).data.name);
  assert.equal(saved.data.environments[0].id, created.data.environments[0].id);
  const other = await request('POST', { name: 'Otro proyecto' });
  assert.equal((await request('PUT', { ...payload, revision: 0 }, other.data.id)).status, 400);
});

test('invalid authorization, scope, roles, credentials and limits are rejected by the API', async t => {
  const cases = [
    ['pending authorization in one environment', payload => { payload.environments[1].authorizationConfirmed = false; }],
    ['inactive authorization without URL', payload => { delete payload.environments[0].baseUrl; }],
    ['non HTTPS', payload => { payload.environments[0].baseUrl = 'http://qa.example.com'; }],
    ['credentials in URL', payload => { payload.environments[0].baseUrl = 'https://user:fake@qa.example.com'; }],
    ['query string', payload => { payload.environments[0].baseUrl = 'https://qa.example.com/?token=fake'; }],
    ['custom port', payload => { payload.environments[0].baseUrl = 'https://qa.example.com:3000'; }],
    ['encoded path', payload => { payload.environments[0].baseUrl = 'https://qa.example.com/catalogo/%2e%2e'; }],
    ['IP shorthand', payload => { payload.environments[0].baseUrl = 'https://127.1/'; }],
    ['literal metadata IP', payload => { payload.environments[0].baseUrl = 'https://169.254.169.254/'; }],
    ['IPv6 address', payload => { payload.environments[0].baseUrl = 'https://[::1]/'; }],
    ['local DNS suffix', payload => { payload.environments[0].allowedHosts.push('qa.local'); }],
    ['wildcard domain', payload => { payload.environments[0].allowedHosts.push('*.example.com'); }],
    ['domain outside scope', payload => { payload.environments[0].baseUrl = 'https://otro.example.com/catalogo'; }],
    ['host without a corresponding allowlisted path', payload => { payload.environments[0].allowedHosts.push('api.example.com'); }],
    ['similar path prefix', payload => { payload.environments[0].baseUrl = 'https://qa.example.com/catalogos'; }],
    ['excluded starting path', payload => { payload.environments[0].baseUrl = 'https://qa.example.com/catalogo/pagos/orden'; }],
    ['excluded domain without allowlist entry', payload => { payload.environments[0].excludedPaths[0].host = 'otro.example.com'; }],
    ['private mode without roles', payload => { payload.roles = []; }],
    ['role without permissions', payload => { payload.roles[0].permissions = []; }],
    ['case-insensitive duplicate role', payload => { payload.roles.push({ ...payload.roles[0], name: 'lector' }); }],
    ['duplicate permission', payload => { payload.roles[0].permissions.push(payload.roles[0].permissions[0]); }],
    ['plain credential in reference', payload => { payload.roles[0].secretReference = 'synthetic-credential'; }],
    ['unknown password property', payload => { payload.roles[0].password = 'synthetic-credential'; }],
    ['unexpected nested array', payload => { payload.environments[0].allowedPaths = [[]]; }],
    ['null for an optional enum', payload => { payload.environments[0].accessMode = null; }],
    ['negative limit', payload => { payload.executionSettings.maxPages = -1; }],
    ['string limit', payload => { payload.executionSettings.maxPages = '10'; }],
  ];
  for (const [label, mutate] of cases) {
    await t.test(label, async () => {
      const payload = configuration();
      mutate(payload);
      const result = await request('POST', payload);
      assert.equal(result.status, 400, JSON.stringify(result.data));
      assert.doesNotMatch(JSON.stringify(result.data), /token=fake|synthetic-credential|user:fake/);
    });
  }
});

test('browser form encoding is not accepted for writes', async () => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=NoRegistrar',
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 400);
});

require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const { QualityConfigurationDto } = require('../dist/scenarios/dto/quality-configuration.dto');
const { QualityExecutionService } = require('../dist/scenarios/quality-execution.service');

const projectId = 'e7401eb7-067c-42fc-8b15-2e9891719c2b';
const environmentId = 'aefe5fef-f513-4c32-86f7-2020587a8119';
const workspace = { organizationId: 'org-test', role: 'ADMIN' };
const environment = {
  id: environmentId, projectId, authorizationConfirmed: true, authorizedAt: new Date(),
  readOnly: true, allowedHosts: ['example.test'], allowedPaths: ['/qa'], excludedPaths: [],
};
const empty = { findMany: async () => [] };

function monitorFixture() {
  const row = {
    id: 'test-monitor', name: 'Carrito', projectId, environment, environmentId,
    url: 'https://example.test/qa/cart?preview=private-example',
    intervalMinutes: 15, timeoutMs: 10000, active: true, requirementId: 'test-requirement',
    method: 'GET', minStatus: 200, maxStatus: 399,
    requirement: { title: 'Consultar carrito', externalKey: 'HU-1' },
    automationSignature: null, automationCode: null, automationReview: null,
    lastCheckedAt: null, lastLatencyMs: null, lastHttpStatus: null,
  };
  const attempts = new Map();
  const db = {
    project: { findFirst: async ({ where }) => where.id === projectId && where.organizationId === workspace.organizationId ? { id: projectId } : null },
    environment: { findFirst: async ({ where }) => where.id === environment.id && where.projectId === projectId ? environment : null },
    monitor: {
      findFirst: async () => ({ ...row }),
      findMany: async () => [row],
      updateMany: async ({ data }) => {
        for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
        return { count: 1 };
      },
    },
    monitorCheck: {
      findFirst: async ({ where }) => where.id ? attempts.get(where.id) : [...attempts.values()].find(check => check.status === 'QUEUED'),
      create: async ({ data }) => { attempts.set(data.id, data); },
    },
    loadTest: empty, performanceAudit: empty, uxAudit: empty,
    $queryRaw: async () => [{ id: row.id }],
    $transaction: async callback => callback(db),
  };
  return { row, attempts, service: new QualityExecutionService(db) };
}

test('configura disponibilidad, renueva el archivo y usa el mismo monitor al confirmar', async () => {
  const { row, attempts, service } = monitorFixture();
  const saved = await service.configure(projectId, row.id, 'availability', {
    environmentId, intervalMinutes: 25, timeoutMs: 8000, active: false, method: 'HEAD', minStatus: 200, maxStatus: 204,
  }, workspace);
  assert.equal(row.url, 'https://example.test/qa/cart?preview=private-example');
  assert.equal(saved.quality.executionConfig.url, 'https://example.test/qa/cart');
  assert.deepEqual(saved.quality.executionConfig.monitor, {
    intervalMinutes: 25, timeoutMs: 8000, active: false, method: 'HEAD', minStatus: 200, maxStatus: 204,
  });
  assert.equal(saved.quality.automation.prepared, true);
  assert.match(row.automationCode, /AbortSignal\.timeout\(8000\)/);
  assert.match(row.automationCode, /method: "HEAD"/);
  assert.match(row.automationCode, /response.status > 204/);
  assert.doesNotMatch(row.automationCode, /private-example/);
  assert.equal(attempts.size, 0);
  assert.equal((await service.queue(projectId, row.id, 'availability', 'test-attempt', workspace)).status, 'QUEUED');
  await assert.rejects(
    service.configure(projectId, row.id, 'availability', { environmentId, timeoutMs: 12000 }, workspace),
    { status: 409 },
  );
  assert.equal(row.timeoutMs, 8000);
});

test('rechaza destinos y entornos ajenos al alcance y validaciones incompatibles', async () => {
  const { row, service } = monitorFixture();
  for (const options of [{ url: 'https://example.test/admin' }, { url: 'https://other.test/qa' }, { environmentId: 'other' }, { minStatus: 450, maxStatus: 400 }, { stages: [{ duration: '25s', target: 1 }] }]) {
    await assert.rejects(service.configure(projectId, row.id, 'availability', { environmentId, ...options }, workspace), { status: 400 });
  }
  await assert.rejects(service.configure(projectId, row.id, 'availability', { environmentId },
    { ...workspace, organizationId: 'other-org' }), { status: 404 });
  await assert.rejects(service.configure(projectId, row.id, 'load', { environmentId },
    { ...workspace, role: 'EDITOR' }), { status: 403 });
  assert.equal(row.automationSignature, null);
});

test('valida rangos y la estructura de las etapas', () => {
  for (const fields of [{ intervalMinutes: 4 }, { timeoutMs: 60001 }, { active: null }, { method: 'POST' }, { minStatus: 199 }, { stages: [{ duration: '15s', target: 1001 }] }]) {
    assert.ok(validateSync(plainToInstance(QualityConfigurationDto, { environmentId, ...fields })).length > 0);
  }
  assert.deepEqual(validateSync(plainToInstance(QualityConfigurationDto, {
    environmentId, stages: [{ duration: '30s', target: 3 }],
  })), []);
});

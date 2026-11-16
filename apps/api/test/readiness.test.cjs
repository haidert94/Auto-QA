// Pruebas puras del cálculo de IPA. No tocan BD: construyen los inputs a mano.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { readiness } = require('../dist/documents/readiness');

function env(overrides = {}) {
  return {
    id: 'env-' + (overrides.id ?? 'a'),
    projectId: 'p1',
    type: 'QA',
    baseUrl: 'https://app.example.com',
    accessMode: 'PUBLIC',
    authorizationConfirmed: true,
    authorizedAt: new Date(),
    position: 0,
    allowedHosts: ['app.example.com'],
    allowedPaths: [{ host: 'app.example.com', path: '/' }],
    excludedPaths: [],
    prohibitedActions: [],
    testData: null,
    readOnly: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function baseProject(overrides = {}) {
  return {
    id: 'p1', name: 'Demo', description: null, status: 'READY',
    authorizationConfirmed: true, authorizedAt: new Date(), ownerLabel: 'QA Lead',
    priorityModules: [], executionSettings: null, revision: 1,
    ownerId: null, organizationId: null,
    createdAt: new Date(), updatedAt: new Date(),
    environments: [env()],
    roles: [],
    ...overrides,
  };
}

function finding(overrides = {}) {
  return {
    id: 'f1', kind: 'REQUIREMENT', pendingConfirmation: false, text: 'Requisito ejemplo',
    locator: '/doc.pdf#/requirements/0', documentId: 'doc1', documentFilename: 'spec.pdf',
    versionId: 'v1', versionNumber: 1, requirementId: 'req1',
    ...overrides,
  };
}

test('readiness: proyecto sin autorización queda BLOCKED con blocker explícito', () => {
  const project = baseProject({
    environments: [env({ authorizationConfirmed: false, authorizedAt: null })],
  });
  const ipa = readiness(project, [], []);
  assert.equal(ipa.status, 'BLOCKED');
  assert.ok(ipa.blockers.some(b => /autorizaciones/i.test(b)), 'esperaba blocker de autorización');
  const signal = ipa.signals.find(s => s.criterion === 'Aplicación y autorización');
  assert.equal(signal.blocking, true);
  assert.equal(signal.anchors.length, 1);
  assert.equal(signal.anchors[0].kind, 'environment');
});

test('readiness: ambigüedad cuenta y ancla al hallazgo con locator', () => {
  const project = baseProject();
  const ipa = readiness(project, [], [
    finding({ id: 'f-ok', kind: 'REQUIREMENT', pendingConfirmation: false }),
    finding({ id: 'f-amb', kind: 'REQUIREMENT', pendingConfirmation: true, text: 'Algo ambiguo', locator: '/doc.pdf#/r/1' }),
  ]);
  assert.equal(ipa.verifiable, 1);
  assert.equal(ipa.ambiguous, 1);
  const signal = ipa.signals.find(s => s.criterion === 'Documentación funcional');
  const anchor = signal.anchors.find(a => a.kind === 'finding' && a.id === 'f-amb');
  assert.ok(anchor, 'esperaba ancla al hallazgo ambiguo');
  assert.equal(anchor.locator, '/doc.pdf#/r/1');
  assert.equal(anchor.documentId, 'doc1');
});

test('readiness: alcance incompleto bloquea y expone ancla al entorno', () => {
  const project = baseProject({
    environments: [env({ allowedHosts: ['otra.com'] })],
  });
  const ipa = readiness(project, [], []);
  assert.equal(ipa.status, 'BLOCKED');
  assert.ok(ipa.blockers.some(b => /alcance/i.test(b)));
  const signal = ipa.signals.find(s => s.criterion === 'Alcance y seguridad');
  assert.equal(signal.blocking, true);
  assert.equal(signal.anchors.length, 1);
});

test('readiness: proyecto archivado produce blocker aunque los entornos estén bien', () => {
  const project = baseProject({ status: 'ARCHIVED' });
  const ipa = readiness(project, [], []);
  assert.equal(ipa.status, 'BLOCKED');
  assert.ok(ipa.blockers.some(b => /archivado/i.test(b)));
});

test('readiness: hints separa recomendaciones no bloqueantes', () => {
  const project = baseProject({
    environments: [env({ allowedPaths: [{ host: 'app.example.com', path: '/' }], testData: null })],
    roles: [],
  });
  const ipa = readiness(project, [], []);
  // "Datos y preparación" (no bloqueante) debe aportar hints sin estar en blockers.
  assert.ok(ipa.hints.some(h => /Datos de prueba|semillas/i.test(h)));
  assert.ok(!ipa.blockers.some(b => /semillas/i.test(b)));
});

test('readiness: recomendations conserva compat con la salida anterior', () => {
  const project = baseProject({
    environments: [env({ authorizationConfirmed: false, authorizedAt: null })],
  });
  const ipa = readiness(project, [], []);
  assert.ok(Array.isArray(ipa.recommendations));
  assert.ok(ipa.recommendations.some(r => /autorización/i.test(r)));
});

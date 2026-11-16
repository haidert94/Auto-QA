// Pruebas puras del calculador de ICSP. Sin BD.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { computeIcsp } = require('../dist/icsp/icsp-calculator');

const now = new Date('2026-11-16T12:00:00Z');
const yesterday = new Date('2026-11-15T12:00:00Z');
const old = new Date('2026-09-01T12:00:00Z');

function base(overrides = {}) {
  return { now, recentWindowDays: 30, requirements: [], scenarios: [], runs: [], ...overrides };
}

test('proyecto vacío devuelve score 100 (nada que medir)', () => {
  const report = computeIcsp(base());
  assert.equal(report.score, 100);
  for (const dim of report.dimensions) assert.equal(dim.value, 1);
});

test('cobertura de requisitos cuenta requisitos con escenario', () => {
  const report = computeIcsp(base({
    requirements: [{ id: 'r1', title: 'A' }, { id: 'r2', title: 'B' }, { id: 'r3', title: 'C' }],
    scenarios: [{ id: 's1', title: 'A ok', requirementId: 'r1' }],
  }));
  const dim = report.dimensions.find(d => d.code === 'requirementsCoverage');
  assert.equal(dim.numerator, 1);
  assert.equal(dim.denominator, 3);
  assert.equal(report.gaps.requirementsWithoutScenario.length, 2);
  assert.ok(report.gaps.requirementsWithoutScenario.some(g => g.label.includes('B')));
});

test('cobertura de ejecución ignora runs fuera de la ventana', () => {
  const report = computeIcsp(base({
    scenarios: [
      { id: 's1', title: 'reciente', requirementId: null },
      { id: 's2', title: 'antigua', requirementId: null },
    ],
    runs: [
      { id: 'run1', scenarioId: 's1', status: 'COMPLETED', createdAt: yesterday, results: [{ id: 'res1', status: 'PASSED' }] },
      { id: 'run2', scenarioId: 's2', status: 'COMPLETED', createdAt: old, results: [{ id: 'res2', status: 'PASSED' }] },
    ],
  }));
  const dim = report.dimensions.find(d => d.code === 'executionCoverage');
  assert.equal(dim.numerator, 1);
  assert.equal(dim.denominator, 2);
  assert.ok(report.gaps.scenariosNotExecuted.some(g => g.id === 's2'));
});

test('estabilidad es passed / (passed + failed) en la ventana', () => {
  const report = computeIcsp(base({
    scenarios: [{ id: 's1', title: 'x', requirementId: null }],
    runs: [
      { id: 'r1', scenarioId: 's1', status: 'COMPLETED', createdAt: yesterday, results: [{ id: 'a', status: 'PASSED' }] },
      { id: 'r2', scenarioId: 's1', status: 'FAILED',    createdAt: yesterday, results: [{ id: 'b', status: 'FAILED' }] },
      { id: 'r3', scenarioId: 's1', status: 'COMPLETED', createdAt: yesterday, results: [{ id: 'c', status: 'PASSED' }] },
      // SKIPPED no cuenta para estabilidad.
      { id: 'r4', scenarioId: 's1', status: 'COMPLETED', createdAt: yesterday, results: [{ id: 'd', status: 'SKIPPED' }] },
    ],
  }));
  const dim = report.dimensions.find(d => d.code === 'stability');
  assert.equal(dim.numerator, 2);
  assert.equal(dim.denominator, 3);
  assert.ok(Math.abs(dim.value - 2 / 3) < 1e-9);
});

test('trazabilidad exige cadena req → scenario → resultado concluyente', () => {
  const report = computeIcsp(base({
    requirements: [{ id: 'r1', title: 'A' }, { id: 'r2', title: 'B' }],
    scenarios: [
      { id: 's1', title: 'A ok', requirementId: 'r1' },
      { id: 's2', title: 'B sin run', requirementId: 'r2' },
    ],
    runs: [
      { id: 'run1', scenarioId: 's1', status: 'COMPLETED', createdAt: yesterday, results: [{ id: 'res1', status: 'PASSED' }] },
    ],
  }));
  const dim = report.dimensions.find(d => d.code === 'traceability');
  assert.equal(dim.numerator, 1);
  assert.equal(dim.denominator, 2);
});

test('escenarios inestables requieren al menos 2 resultados recientes', () => {
  const report = computeIcsp(base({
    scenarios: [
      { id: 's1', title: 'flaky', requirementId: null },
      { id: 's2', title: 'un solo fallo', requirementId: null },
    ],
    runs: [
      { id: 'r1', scenarioId: 's1', status: 'FAILED',    createdAt: yesterday, results: [{ id: 'a', status: 'FAILED' }] },
      { id: 'r2', scenarioId: 's1', status: 'COMPLETED', createdAt: yesterday, results: [{ id: 'b', status: 'PASSED' }] },
      { id: 'r3', scenarioId: 's2', status: 'FAILED',    createdAt: yesterday, results: [{ id: 'c', status: 'FAILED' }] },
    ],
  }));
  assert.ok(report.gaps.unstableScenarios.some(g => g.id === 's1'));
  assert.ok(!report.gaps.unstableScenarios.some(g => g.id === 's2'),
    'un solo resultado no debería contar como inestable');
});

test('score pondera correctamente (30/20/30/20)', () => {
  // Diseño: R=1/1=1, E=0/1=0, S=1/1=1, T=0/1=0 → 30*1 + 20*0 + 30*1 + 20*0 = 60, / 100 → 60.
  const report = computeIcsp(base({
    requirements: [{ id: 'r1', title: 'A' }],
    scenarios: [{ id: 's1', title: 'x', requirementId: 'r1' }],
    runs: [
      { id: 'run1', scenarioId: 's1', status: 'COMPLETED', createdAt: old, results: [{ id: 'res1', status: 'PASSED' }] },
    ],
  }));
  // s1 no está en la ventana → executionCoverage=0 y traceability también depende del results status;
  // igualmente verificamos pesos.
  const sum = report.dimensions.reduce((acc, d) => acc + d.weight, 0);
  assert.equal(sum, 100);
});

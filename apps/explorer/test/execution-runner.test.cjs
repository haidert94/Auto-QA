const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { test } = require('node:test');
const { chromium, firefox, webkit } = require('playwright-core');
const { runTestRun } = require('../dist/explorer/src/execution-runner');

for (const [targetBrowser, engine] of Object.entries({ CHROMIUM: chromium, FIREFOX: firefox, WEBKIT: webkit })) {
  test(`Explorer carga Playwright desde la carpeta temporal, ejecuta ${targetBrowser} y guarda el resultado`, {
    skip: !existsSync(engine.executablePath()) && 'El motor de Playwright no está instalado.',
    timeout: 20000,
  }, async () => {
    const claim = {
      id: 'ejecucion', projectId: 'proyecto', scenarioId: 'caso', environmentId: 'qa',
      runKey: null, targetBrowser, targetDevice: null, targetProvider: 'LOCAL',
    };
    const run = { status: 'RUNNING', errorCode: null };
    let result;
    const prisma = {
      testRun: {
        async findUnique() { return { ...run }; },
        async update({ data }) { Object.assign(run, data); },
      },
      testScenario: { async findUnique() {
        return { id: claim.scenarioId, title: 'Página vacía', tags: [], steps: [{ ordinal: 1, action: 'expect-url: about:blank' }] };
      } },
      environment: { async findUnique() {
        return { type: 'QA', authorizationConfirmed: true, readOnly: true, baseUrl: null };
      } },
      testResult: { async create({ data }) { result = data; } },
      async $queryRaw() { return [{ errorCode: null }]; },
      async $transaction(callback) { return callback(prisma); },
    };
    const storage = { async put(zip) {
      assert.ok(zip.length > 0);
      return 'traza-de-prueba';
    } };
    await runTestRun(prisma, claim, storage);
    assert.equal(run.status, 'COMPLETED', JSON.stringify({ errorCode: run.errorCode, result }));
    assert.equal(run.targetBrowser, targetBrowser);
    assert.equal(result.status, 'PASSED');
    assert.equal(result.evidenceKey, 'traza-de-prueba');
  });
}

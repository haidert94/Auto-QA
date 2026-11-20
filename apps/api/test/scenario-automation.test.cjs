const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const { ScenariosService } = require('../dist/scenarios/scenarios.service');
const { RunsService } = require('../dist/runs/runs.service');
const { RunsController } = require('../dist/runs/runs.controller');
const { UsageService } = require('../dist/commerce/usage.service');
const { IcspService } = require('../dist/icsp/icsp.service');
const { ReportsService } = require('../dist/reports/reports.service');
const { REPORT_SCENARIO_SCOPE } = require('../dist/runs/run-report-policy');
const { translateAgentActions, readPreparedAutomation } = require('../dist/scenarios/automation-agent');
const { generateHarnessedSpec, generateSpec } = require('../dist/scenarios/playwright-generator');

const workspace = { organizationId: 'test-org' };
const sample = {
  id: 'scenario', projectId: 'project', tags: [],
  title: 'Buscar un producto',
  expectedResult: 'Se muestra el encabezado de resultados',
  steps: [
    { ordinal: 1, action: 'Abre la página de inicio' },
    { ordinal: 2, action: 'Escribe fixture-input en el campo Buscar', data: 'fixture-input' },
    { ordinal: 3, action: 'Pulsa el botón Buscar y comprueba el encabezado Resultados' },
  ],
  automation: null,
};
const actions = [
  { step: 1, kind: 'navigate', target: '/' },
  { step: 2, kind: 'fill-label', target: 'Buscar' },
  { step: 3, kind: 'click-text', target: 'Buscar' },
  { step: 3, kind: 'expect-text', target: 'Resultados' },
];

function fixture(dispatch, row = { ...sample }, environment = { id: 'qa', authorizationConfirmed: true, readOnly: true }) {
  const prisma = {
    async $transaction(callback) { return callback(prisma); },
    async $queryRaw() { return [{ id: row.id }]; },
    project: { async findFirst() { return { id: 'project' }; } },
    environment: { async findFirst() { return environment; } },
    testScenario: {
      async findFirst() { return { ...row }; },
      async findMany() { return [{ ...row }]; },
      async updateMany({ where, data }) {
        if (row.title !== where.title) return { count: 0 };
        row.automation = JSON.parse(JSON.stringify(data.automation));
        return { count: 1 };
      },
    },
    testRun: {
      async create({ data }) { return JSON.parse(JSON.stringify(data)); },
    },
  };
  return {
    row,
    service: new ScenariosService(prisma, { dispatch }),
    runs: new RunsService(prisma, { async reserveRun() {} }, {}, {}),
  };
}

test('prepara un escenario en lenguaje natural, guarda la versión y reutiliza sus acciones al encolar', async () => {
  let calls = 0;
  const { row, service, runs } = fixture(async ({ operation, prompt, organizationId }) => {
    calls++;
    assert.equal(operation, 'scenario-generation');
    assert.equal(organizationId, workspace.organizationId);
    assert.match(prompt, /Abre la página de inicio/);
    assert.ok(!prompt.includes('fixture-input'));
    return { model: 'model-test', text: JSON.stringify({ actions }) };
  });
  const list = async () => (await service.list('project', workspace))[0];
  assert.equal((await list()).playwright, null);
  const preview = await service.generatePlaywright('project', 'scenario', workspace);
  assert.equal(preview.automationId, null);
  assert.equal(calls, 0);
  const prepared = await service.preparePlaywright('project', 'scenario', workspace);
  assert.equal(calls, 1);
  assert.equal(prepared.automationId, row.automation.id);
  const listed = await list();
  assert.deepEqual(listed.playwright, { automationId: prepared.automationId, filename: prepared.filename });
  assert.ok(!Object.hasOwn(listed, 'automation'));
  assert.match(prepared.code, /page\.getByLabel\('Buscar', \{ exact: true \}\)\.fill\('fixture-input'\)/);
  assert.match(prepared.code, /expect\(page\.getByText\('Resultados'\)\)\.toBeVisible/);
  assert.equal((await service.generatePlaywright('project', 'scenario', workspace)).code, prepared.code);
  assert.equal((await service.preparePlaywright('project', 'scenario', workspace)).automationId, prepared.automationId);
  assert.equal(calls, 1);

  const queued = await runs.create('project', 'scenario', { environmentId: 'qa', automationId: prepared.automationId }, workspace);
  const snapshot = readPreparedAutomation(queued.automation);
  assert.deepEqual(snapshot.steps.map(step => step.action), ['navigate: /', 'fill-label: Buscar', 'click-text: Buscar', 'expect-text: Resultados']);
  const workerSpec = generateHarnessedSpec({ id: 'scenario', title: snapshot.title, steps: snapshot.steps }, {
    baseUrl: 'https://example.test', allowedHosts: ['example.test'], allowedPaths: [], excludedPaths: [],
  });
  for (const line of prepared.code.split('\n').filter(line => line.trim().startsWith('await '))) {
    assert.ok(workerSpec.includes(line), 'El worker usa las acciones del archivo revisado');
  }
  for (const spec of [prepared.code, workerSpec]) {
    const compiled = ts.transpileModule(spec, { reportDiagnostics: true });
    assert.deepEqual(compiled.diagnostics, []);
  }

  row.tags = ['@manual'];
  assert.equal((await list()).playwright, null);
  row.tags = [];
  row.title = 'Escenario editado';
  assert.equal((await list()).playwright, null);
  assert.equal((await service.generatePlaywright('project', 'scenario', workspace)).automationId, null);
  await assert.rejects(runs.create('project', 'scenario', { environmentId: 'qa', automationId: prepared.automationId }, workspace), /automatización cambió/);
  assert.equal(snapshot.title, sample.title);
  assert.notEqual((await service.preparePlaywright('project', 'scenario', workspace)).automationId, prepared.automationId);
  assert.equal(calls, 2);
});

test('el reporte consolidado espera la primera ejecución finalizada e ignora las canceladas', async () => {
  let active = { id: 'active-run' };
  const runs = [{ id: 'canceled', scenarioId: 'scenario', status: 'CANCELED', createdAt: new Date(), results: [] }];
  let documentReads = 0;
  const prisma = {
    project: { async findFirst({ where }) {
      assert.equal(where.organizationId, workspace.organizationId);
      return { id: 'project' };
    } },
    requirement: { async findMany() { return [{ id: 'requirement', title: 'Requisito' }]; } },
    testScenario: { async findMany() { return [{ id: 'scenario', title: 'Escenario', requirementId: 'requirement' }]; } },
    testRun: {
      async findFirst({ where }) {
        assert.deepEqual(where, { projectId: 'project', status: { in: ['QUEUED', 'RUNNING'] } });
        return active;
      },
      async findMany({ where }) {
        assert.deepEqual(where, { projectId: 'project', status: { in: ['COMPLETED', 'FAILED'] }, ...REPORT_SCENARIO_SCOPE });
        return runs.filter(run => where.status.in.includes(run.status));
      },
    },
  };
  const documents = { async report() { documentReads++; return { ipa: { score: 80 }, analysis: null }; } };
  const reports = new ReportsService(prisma, documents, new IcspService(prisma));
  await assert.rejects(reports.export('project', workspace), /cuando finalicen las ejecuciones/);
  active = null;
  await assert.rejects(reports.export('project', workspace), /primera ejecución finalizada/);
  assert.equal(documentReads, 0);
  runs.push({ id: 'done', scenarioId: 'scenario', status: 'FAILED', createdAt: new Date(), results: [] });
  const report = await reports.export('project', workspace);
  assert.equal(report.icsp.counts.runs, 1);
  assert.equal(report.traceability[0].scenarios[0].lastRun.id, 'done');
  assert.equal(documentReads, 1);
});

test('la actividad cuenta solo las ejecuciones en curso y en cola del proyecto autorizado', async () => {
  const queuedAt = new Date(Date.now() - 125000);
  let counts = [{ status: 'QUEUED', errorCode: null, _count: { _all: 2 }, _min: { createdAt: queuedAt } }];
  const prisma = {
    project: { async findFirst({ where }) {
      assert.deepEqual(where, { id: 'project', organizationId: workspace.organizationId });
      return { id: 'project' };
    } },
    testRun: { async groupBy(query) {
      assert.deepEqual(query, {
        by: ['status', 'errorCode'], where: { projectId: 'project', status: { in: ['RUNNING', 'QUEUED'] } }, _count: { _all: true }, _min: { createdAt: true },
      });
      return counts;
    } },
  };
  const controller = new RunsController(new RunsService(prisma, {}, {}, {}));
  const { oldestQueuedSeconds, ...queuedActivity } = await controller.activity('project', workspace);
  assert.deepEqual(queuedActivity, { running: 0, queued: 2, stopping: 0 });
  assert.ok(oldestQueuedSeconds >= 125 && oldestQueuedSeconds < 180);
  counts = [
    { status: 'RUNNING', errorCode: null, _count: { _all: 1 } },
    { status: 'RUNNING', errorCode: 'cancel-requested', _count: { _all: 2 } },
  ];
  assert.deepEqual(await controller.activity('project', workspace), { running: 1, queued: 0, stopping: 2, oldestQueuedSeconds: 0 });
  counts = [];
  assert.deepEqual(await controller.activity('project', workspace), { running: 0, queued: 0, stopping: 0, oldestQueuedSeconds: 0 });
});

test('detener cancela la cola, libera solo sus reservas y solicita detener las activas del proyecto', async () => {
  let queued = [{ runKey: 'queued-1' }, { runKey: null }];
  let running = 1;
  let released = 0;
  const tx = {
    testRun: {
      async updateManyAndReturn({ where, data, select }) {
        assert.deepEqual(where, { projectId: 'project', status: 'QUEUED' });
        assert.deepEqual(select, { runKey: true });
        assert.equal(data.status, 'CANCELED');
        assert.equal(data.errorCode, 'canceled-by-user');
        assert.ok(data.completedAt instanceof Date);
        const canceled = queued;
        queued = [];
        return canceled;
      },
      async updateMany({ where, data }) {
        assert.equal(where.projectId, 'project');
        assert.equal(where.status, 'RUNNING');
        assert.deepEqual(data, { errorCode: 'cancel-requested' });
        const count = running;
        running = 0;
        return { count };
      },
    },
    meteredRun: { async updateMany({ where, data }) {
      assert.deepEqual(where, { projectId: 'project', organizationId: workspace.organizationId,
        runKey: { in: ['queued-1'] }, completedAt: null });
      assert.equal(data.browserSeconds, 0);
      released++;
    } },
  };
  const prisma = {
    project: { async findFirst({ where }) {
      assert.equal(where.organizationId, workspace.organizationId);
      return where.id === 'project' ? { id: where.id } : null;
    } },
    $transaction: callback => callback(tx),
  };
  const controller = new RunsController(new RunsService(prisma, {}, {}, {}));
  await assert.rejects(controller.cancel('other-project', workspace), /Proyecto no encontrado/);
  assert.deepEqual(await controller.cancel('project', workspace), { queuedCanceled: 2, runningRequested: 1 });
  assert.deepEqual(await controller.cancel('project', workspace), { queuedCanceled: 0, runningRequested: 0 });
  assert.equal(released, 1);
});

test('consulta las ejecuciones pedidas sin salir del alcance del proyecto', async () => {
  const first = '10000000-0000-4000-8000-000000000001';
  const second = '10000000-0000-4000-8000-000000000002';
  const prisma = {
    project: { async findFirst({ where }) {
      assert.deepEqual(where, { id: 'project', organizationId: workspace.organizationId });
      return { id: 'project' };
    } },
    testRun: { async findMany({ where }) {
      assert.deepEqual(where, { projectId: 'project', id: { in: [first, second] } });
      return [{ id: first, status: 'RUNNING' }];
    } },
  };
  const controller = new RunsController(new RunsService(prisma, {}, {}, {}));
  assert.deepEqual(await controller.list('project', [first, second].join(','), workspace), [{ id: first, status: 'RUNNING' }]);
  assert.throws(() => controller.list('project', 'invalid', workspace), /identificadores válidos/);
  assert.throws(() => controller.list('project', Array(101).fill(first).join(','), workspace), /identificadores válidos/);
});

test('el historial del reporte omite canceladas antes del límite y conserva ejecuciones activas', async () => {
  const runs = [
    { id: 'canceled', status: 'CANCELED' },
    { id: 'waiting', status: 'QUEUED' },
    { id: 'running', status: 'RUNNING' },
    { id: 'completed', status: 'COMPLETED' },
  ];
  const prisma = {
    project: { async findFirst({ where }) {
      assert.deepEqual(where, { id: 'project', organizationId: workspace.organizationId });
      return { id: 'project' };
    } },
    testRun: { async findMany({ where, take }) {
      assert.equal(where.projectId, 'project');
      assert.equal(take, 100);
      return runs.filter(run => run.status !== where.status?.not).slice(0, take);
    } },
  };
  const controller = new RunsController(new RunsService(prisma, {}, {}, {}));
  assert.deepEqual(await controller.list('project', undefined, workspace, 'report'), runs.slice(1));
  assert.deepEqual(await controller.list('project', undefined, workspace), runs);
});

test('Enterprise muestra minutos sin límite y reserva navegador respetando la simultaneidad', async () => {
  const browser = { code: 'BROWSER_TESTS', availability: 'OPERATIONAL', browsers: ['CHROMIUM'], monthlyLimit: null };
  const plan = { code: 'enterprise', parallelRuns: 8, maxProjects: 999, maxRoles: 999, capabilities: [browser] };
  const subscription = { plan, status: 'ACTIVE', periodEndsAt: new Date(Date.now() + 60000) };
  let active = 0;
  let reserved = 0;
  const tx = {
    async $queryRaw() {},
    subscription: { async findUnique() { return subscription; } },
    project: { async findFirst() { return { id: 'project' }; }, async findMany() { return []; } },
    meteredMonitor: { async count() { return 0; } },
    meteredRun: {
      async findUnique() { return null; },
      async count() { return 0; },
      async aggregate({ where }) {
        return where.completedAt === null
          ? { _sum: { reservedBrowserSeconds: reserved }, _count: active }
          : { _sum: { browserSeconds: 0 }, _count: 0 };
      },
      async create({ data }) { active++; reserved += data.reservedBrowserSeconds; return data; },
    },
  };
  const usage = new UsageService({ $transaction: callback => callback(tx) });
  const reserve = key => usage.reserveRun('test-org', 'project', key, { kind: 'BROWSER', browser: 'CHROMIUM', browserSeconds: 120 });
  assert.deepEqual((await usage.summary('test-org')).browser, {
    secondsUsed: 0, secondsReserved: 0, minutesLimit: null, availability: 'OPERATIONAL',
  });
  assert.equal((await reserve('run-1')).reservedBrowserSeconds, 120);
  assert.equal((await usage.summary('test-org')).browser.secondsReserved, 120);

  active = 8;
  await assert.rejects(reserve('run-2'), error => {
    assert.match(error.message, /ejecuciones simultáneas/);
    assert.equal(error.getResponse().code, 'RUN_CONCURRENCY_LIMIT');
    return true;
  });
  active = 1;
  browser.monthlyLimit = 3;
  assert.equal((await usage.summary('test-org')).browser.minutesLimit, 3);
  await assert.rejects(reserve('run-2'), /minutos de navegador/);
  browser.monthlyLimit = null;
  browser.availability = 'NOT_INCLUDED';
  assert.equal((await usage.summary('test-org')).browser.minutesLimit, 0);
  await assert.rejects(reserve('run-2'), /no está incluida/);
});

test('exige una confirmación vigente para encolar cambios con datos de prueba', async () => {
  const authorizedAt = new Date('2026-11-19T12:00:00.000Z');
  const environment = { id: 'qa', type: 'QA', authorizationConfirmed: true, readOnly: false, authorizedAt };
  const { runs } = fixture(async () => {}, { ...sample }, environment);
  const queue = (writeAuthorizationAt) => runs.create('project', 'scenario', { environmentId: 'qa', writeAuthorizationAt }, workspace);

  await assert.rejects(queue(), /falta confirmar/);
  await assert.rejects(queue('2026-11-18T12:00:00.000Z'), /entorno cambió/);
  assert.equal((await queue(authorizedAt.toISOString())).writeAuthorizationAt, authorizedAt.toISOString());
  environment.type = 'PRODUCTION';
  await assert.rejects(queue(authorizedAt.toISOString()), /Desarrollo, QA o Preproducción/);
  environment.readOnly = true;
  await assert.rejects(queue(authorizedAt.toISOString()), /entorno cambió/);
  assert.equal((await queue()).writeAuthorizationAt, null);
  environment.authorizationConfirmed = false;
  await assert.rejects(queue(), /Confirma la autorización/);
});

test('mantiene en revisión un caso incompleto y omite el agente para un caso manual', async () => {
  let calls = 0;
  const { row, service } = fixture(async () => {
    calls++;
    return { model: 'model-test', text: JSON.stringify({ actions: actions.slice(0, 2) }) };
  });
  const result = await service.preparePlaywright('project', 'scenario', workspace);
  assert.equal(result.automationId, null);
  assert.match(result.notice, /no pudo completar/);
  assert.match(result.code, /TODO/);
  assert.equal(row.automation, null);
  row.tags = ['@manual'];
  await assert.rejects(service.preparePlaywright('project', 'scenario', workspace), /ejecución manual/);
  assert.equal(calls, 1);
});

test('valida el orden, la cobertura, las aserciones, los destinos y los datos de entrada', () => {
  assert.ok(translateAgentActions(actions, sample.steps));
  assert.ok(translateAgentActions([{ ...actions[0], target: '/search?q=products' }, ...actions.slice(1)], sample.steps));
  assert.equal(translateAgentActions(actions.slice(1), sample.steps), null);
  assert.equal(translateAgentActions(actions.slice(0, -1), sample.steps), null);
  assert.equal(translateAgentActions([{ ...actions[0], target: '//outside.example.test' }, ...actions.slice(1)], sample.steps), null);
  assert.equal(translateAgentActions([{ ...actions[0], kind: 'unsupported' }, ...actions.slice(1)], sample.steps), null);
  assert.equal(translateAgentActions(actions, sample.steps.map(step => ({ ...step, data: undefined }))), null);
  assert.equal(translateAgentActions([{ ...actions[0], target: '/\ninvalid' }, ...actions.slice(1)], sample.steps), null);
  assert.equal(readPreparedAutomation({ id: 'run', signature: 'signature', title: 'Title', steps: sample.steps }), null);
});

test('la automatización conserva la comprobación HTTP explícita del escenario', () => {
  const source = [{ ordinal: 1, action: 'expect-http-ok: https://example.test/' }];
  assert.equal(translateAgentActions([{ step: 1, kind: 'expect-url', target: '/' }], source), null);
  assert.deepEqual(
    translateAgentActions([{ step: 1, kind: 'expect-http-ok', target: '/' }], source).map(step => step.action),
    ['expect-http-ok: /'],
  );
});

test('las instrucciones sin traducir se conservan como comentarios de revisión', () => {
  const spec = generateSpec({ id: 'scenario', title: 'Caso', steps: [{ ordinal: 1, action: 'Primera línea\u2028Segunda línea' }] });
  assert.match(spec, /\/\/ TODO: Primera línea\n\s*\/\/ Segunda línea/);
});

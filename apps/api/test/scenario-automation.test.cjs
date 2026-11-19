const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const { ScenariosService } = require('../dist/scenarios/scenarios.service');
const { RunsService } = require('../dist/runs/runs.service');
const { RunsController } = require('../dist/runs/runs.controller');
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

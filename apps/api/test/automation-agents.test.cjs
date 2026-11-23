const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');

const { runCompatibilityAgent } = require('../dist/automation/agents/compatibility-agent');
const { runFunctionalWebAgent } = require('../dist/automation/agents/functional-web-agent');
const { runMobileAgent } = require('../dist/automation/agents/mobile-agent');
const { runSelectedAgents } = require('../dist/automation/agents');
const { AutomationService } = require('../dist/automation/automation.service');
const { runAutomation } = require('../dist/automation/pipeline-runner');
const { RunsService } = require('../dist/runs/runs.service');
const { ScenariosService } = require('../dist/scenarios/scenarios.service');

const context = {
  projectId: 'project',
  organizationId: null,
  jobId: 'job',
  runKey: null,
  environmentId: null,
  url: 'https://example.test',
  description: null,
  review: { stories: [{ title: 'Inicio de sesión', coverage: 'completa', notes: 'La ayuda de acceso debe ser comprensible.' }] },
  requirements: [{ id: 'requirement-id', externalKey: 'HU-D01', title: 'Información de errores', criteria: [{ text: 'El mensaje debe indicar cómo volver a intentar.' }] }],
};
const steps = [{ action: 'navigate: /login' }, { action: 'expect-text: Iniciar sesión' }];
const readyProject = {
  id: 'project', status: 'READY', ownerLabel: 'QA', organizationId: null, roles: [],
  environments: [{ id: 'env', type: 'QA', baseUrl: context.url, authorizationConfirmed: true, authorizedAt: new Date(),
    accessMode: 'PUBLIC', allowedHosts: ['example.test'], allowedPaths: [{ host: 'example.test', path: '/' }], excludedPaths: [] }],
};
const processedVersion = { uploadedAt: new Date(), processedAt: new Date(), validatedAt: new Date(), hasText: true };
function traceableFinding(versionId, overrides = {}) {
  return { id: versionId, kind: 'USER_STORY', requirementId: 'requirement-id', pendingConfirmation: false,
    requirement: { _count: { criteria: 1 } }, versionId,
    version: { id: versionId, number: 1, document: { id: 'document', filename: 'historias.md' } }, ...overrides };
}

for (const [agent, typeTag] of [[runFunctionalWebAgent, '@funcional'], [runMobileAgent, '@mobile']]) {
  test(agent.name + ' guarda la clasificación de regresión y ejecución manual por escenario', async () => {
    const created = [];
    const outcomes = await agent(context, {
      router: {
        async dispatch({ prompt }) {
          assert.match(prompt, /"regression": true/);
          assert.match(prompt, /"mode": "manual"/);
          assert.match(prompt, /aserción explícita/);
          assert.ok(prompt.includes(context.review.stories[0].notes));
          assert.ok(prompt.includes(context.requirements[0].criteria[0].text));
          assert.match(prompt, /\[HU-D01\]/);
          assert.ok(prompt.includes(context.review.stories[0].title));
          return {
            model: 'test',
            text: JSON.stringify({
              scenarios: [
                { title: 'Validar credenciales incorrectas', flow: 'alterno', regression: true, tags: ['@regression', '@login'], steps },
                { title: 'Omitir clasificación explícita nueva', flow: 'basico', requirementId: 'HU-D01', tags: [' @Regresión '], steps },
                { title: 'Primer acceso a un módulo nuevo', flow: 'basico', regression: false, tags: ['@regresion', '@nuevo'], steps },
                { title: 'Caso sin clasificar', flow: 'basico', tags: ['@manual'], requirementId: 'unrelated', steps },
                { title: 'Conservar regresión al limitar las etiquetas', regression: true, tags: Array.from({ length: 24 }, (_, i) => '@tag' + i), steps },
                {
                  title: 'Revisar la claridad de la ayuda de acceso',
                  mode: 'manual',
                  flow: 'alterno',
                  regression: true,
                  requirementId: context.requirements[0].id,
                  tags: ['@manual'],
                  expectedResult: 'La ayuda indica cómo recuperar el acceso.',
                  steps: [{ action: 'Lee el mensaje de ayuda y comprueba si indica cómo recuperar el acceso.', expected: 'Indica cómo recuperar el acceso.' }],
                },
                { title: 'Manual incompleto', mode: 'manual', expectedResult: '  ', steps },
                { title: 'Solo navegación', expectedResult: 'Abre Inicio', steps: [steps[0], { action: 'expect-text: ' }] },
              ].map(scenario => ({ requirementId: context.requirements[0].id, ...scenario })),
            }),
          };
        },
      },
      prisma: { testScenario: { async create({ data }) { created.push(data); } } },
    });

    assert.equal(outcomes.created, 5);
    assert.equal(outcomes.errors.length, 3);
    assert.match(outcomes.errors[0], /-3-sin-requisito-verificable$/);
    assert.match(outcomes.errors[1], /-6-sin-resultado-esperado$/);
    assert.match(outcomes.errors[2], /-7-sin-asercion$/);
    assert.deepEqual(created[0].tags, [typeTag, '@flujoAlterno', '@regresion', '@login']);
    assert.deepEqual(created[1].tags, [typeTag, '@flujoBasico', '@regresion']);
    assert.deepEqual(created[2].tags, [typeTag, '@flujoBasico', '@nuevo']);
    assert.equal(created[3].tags.length, 20);
    assert.ok(created[3].tags.includes('@regresion'));
    assert.deepEqual(created[4].tags, [typeTag, '@manual', '@flujoAlterno', '@regresion']);
    assert.ok(created.every(item => item.requirementId === context.requirements[0].id));
    assert.equal(created[4].steps[0].action, 'Lee el mensaje de ayuda y comprueba si indica cómo recuperar el acceso.');
    assert.equal(created[4].expectedResult, 'La ayuda indica cómo recuperar el acceso.');
  });
}

test('la generación usa los requisitos de la versión documental vigente del proyecto', async () => {
  const saved = [];
  const generationUpdates = [];
  const signature = createHash('sha256').update(JSON.stringify(['rules-v1', [['document', 'version']]])).digest('hex');
  const prisma = {
    project: { async findUnique() { return readyProject; }, async findUniqueOrThrow() { return readyProject; } },
    automationJob: {
      async findUnique() { return { result: { review: { stories: [] } }, steps: {} }; },
      async update({ data }) {
        if (data.stage === 'generated') generationUpdates.push(data.result.generation.totalCreated);
      },
    },
    document: {
      async findMany({ where }) {
        assert.deepEqual(where, { projectId: 'project', removedAt: null });
        return [{ id: 'document', versions: [{ ...processedVersion, id: 'version' }] }];
      },
    },
    documentAnalysis: {
      async findUnique({ where }) {
        assert.deepEqual(where.projectId_signature, { projectId: 'project', signature });
        return { id: 'analysis', findings: [traceableFinding('version')],
          requirements: context.requirements.map(requirement => ({ ...requirement, sources: [{ versionId: 'version', clarification: null }] })),
        };
      },
    },
    testScenario: { async count() { return 0; }, async create({ data }) { saved.push(data); } },
  };
  await runAutomation(prisma, {
    id: 'job', projectId: 'project', priorStage: 'selection-done', runKey: null,
    inputs: { url: context.url, selection: ['functional_web'] },
  }, {
    async dispatch({ prompt }) {
      assert.match(prompt, /Información de errores/);
      assert.ok(prompt.includes(context.requirements[0].criteria[0].text));
      return {
        model: 'test', text: JSON.stringify({ scenarios: [{
          title: 'Revisión manual del mensaje', mode: 'manual', requirementId: 'requirement-id',
          steps: [{ action: 'Revisa si el mensaje explica cómo volver a intentar.', expected: 'El mensaje incluye instrucciones.' }],
          expectedResult: 'La persona sabe cómo continuar.',
        }] }),
      };
    },
  });
  assert.deepEqual(generationUpdates, [1]);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].tags, ['@funcional', '@manual']);
  assert.equal(saved[0].requirementId, 'requirement-id');
});

test('la API rechaza generar código o encolar Playwright para un caso manual', async () => {
  const prisma = {
    project: { async findFirst() { return { id: 'project' }; } },
    testScenario: { async findFirst() { return { id: 'scenario', tags: ['@manual'] }; } },
  };
  const workspace = { organizationId: null };
  const scenarios = new ScenariosService(prisma, {});
  const runs = new RunsService(prisma, {}, {}, {});
  await assert.rejects(scenarios.generatePlaywright('project', 'scenario', workspace), /requiere ejecución manual/);
  await assert.rejects(runs.create('project', 'scenario', { environmentId: 'environment' }, workspace), /requiere ejecución manual/);
});

test('compatibilidad omite los casos sin escenario base vinculado', async () => {
  const outcome = await runCompatibilityAgent(context, {
    prisma: { testScenario: { async findMany() { return []; } } },
  });
  assert.equal(outcome.created, 0);
  assert.deepEqual(outcome.errors, ['compatibility-no-linked-base']);
});

test('el asistente de requisitos solo devuelve propuestas con aserciones', async () => {
  const service = new ScenariosService({
    project: { async findFirst() { return { id: 'project' }; } },
    requirement: { async findFirst() { return { title: 'Inicio' }; } },
  }, {
    async dispatch({ prompt }) {
      assert.match(prompt, /aserción explícita/);
      return {
        model: 'test',
        text: JSON.stringify({ scenarios: [
          { title: 'Verificar inicio', steps },
          { title: 'Solo abrir inicio', steps: [steps[0]], expectedResult: 'Abre Inicio' },
        ] }),
      };
    },
  });
  const result = await service.suggest('project', 'requirement', { organizationId: null });
  assert.deepEqual(result.scenarios.map(scenario => scenario.title), ['Verificar inicio']);
});

test('las variantes de compatibilidad conservan la etiqueta aunque el caso base tenga 20 etiquetas', async () => {
  const created = [];
  const extraTags = Array.from({ length: 19 }, (_, i) => '@tag-' + i);
  const base = [
    { title: 'Caso de regresión', steps, expectedResult: null, tags: ['@funcional', '@regresion'] },
    { title: 'Caso nuevo', steps, expectedResult: null, tags: ['@funcional', ...extraTags] },
    { title: 'Caso antiguo incompleto', steps: [steps[0]], expectedResult: 'Abre el acceso', tags: ['@funcional'] },
  ].map(scenario => ({ ...scenario, requirementId: context.requirements[0].id }));
  const outcome = await runCompatibilityAgent(context, {
    prisma: {
      testScenario: {
        async findMany({ where }) {
          assert.ok(where.NOT.OR.some(filter => ['@manual', '@compatibilidad', '@compatibility']
            .every(tag => filter.tags?.hasSome.includes(tag))));
          assert.ok(where.NOT.OR.some(filter => filter.title?.startsWith === '[COMPAT:'));
          return base;
        },
        async findFirst() { return null; },
        async create({ data }) { created.push(data); },
      },
    },
  });

  assert.equal(outcome.created, 6);
  for (const [index, browser] of ['@chromium', '@firefox', '@webkit'].entries()) {
    assert.deepEqual(created[index].tags, ['@funcional', '@regresion', '@compatibilidad', browser]);
    assert.deepEqual(created[index].steps, steps);
    assert.deepEqual(created[index + 3].tags, ['@funcional', ...extraTags.slice(0, 17), '@compatibilidad', browser]);
  }
});

test('la generación respeta los tipos documentales confirmados y separa los casos manuales', async () => {
  const saved = [];
  const outcomes = await runSelectedAgents(['functional_web', 'manual'], {
    ...context, documentTestTypesConfirmed: true,
    requirements: [
      { id: 'verifiable', title: 'Pantalla de acceso', criteria: [{ text: 'Aparece el formulario.' }] },
      { id: 'covered', title: 'Caso ya cubierto', criteria: [],
        scenarios: [{ tags: ['@funcional'] }, { tags: ['@manual'] }] },
    ],
  }, {
    prisma: { testScenario: { async create({ data }) { saved.push(data); } } },
    router: { async dispatch({ prompt }) {
      assert.match(prompt, /Pantalla de acceso/);
      assert.doesNotMatch(prompt, /Caso ya cubierto/);
      return { model: "test", text: JSON.stringify({ scenarios: [
      { title: 'Escenario web', mode: 'playwright', requirementId: 'verifiable', steps },
      { title: 'Requisito pendiente', mode: 'playwright', requirementId: 'pending', steps },
      { title: 'Requisito cubierto', mode: 'playwright', requirementId: 'covered', steps },
      { title: 'Revisión humana', mode: 'manual', requirementId: 'verifiable', expectedResult: 'El texto es comprensible.',
        steps: [{ action: 'Lee el texto de ayuda.', expected: 'Se entiende sin ayuda.' }] },
    ] }) }; } },
  });
  assert.deepEqual(outcomes.map(({ type, created }) => [type, created]), [['functional_web', 1], ['manual', 1]]);
  assert.equal(saved.filter(item => item.tags.includes('@manual')).length, 1);
});

test('la API solo confirma tipos con documentos pendientes y comprueba que el alcance siga vigente', async () => {
  const uploadedAt = new Date('2026-11-19T00:00:00Z');
  const docs = [
    { id: 'old', filename: 'web.md', testTypes: ['functional_web', 'manual'], versions: [{ ...processedVersion, id: 'web-version', storageKey: 'old', uploadedAt }] },
    { id: 'new', filename: 'performance.md', testTypes: ['performance'], versions: [{ ...processedVersion, id: 'perf-version', storageKey: 'new', uploadedAt }] },
  ];
  const completed = ['functional_web', 'manual'].map(type => ({ type, created: 1, errorCount: 0 }));
  const historical = {
    inputs: { documentAnalysisId: 'old-analysis' },
    createdAt: new Date('2026-11-20T00:00:00Z'),
    result: { generation: { outcomes: completed } },
  };
  const jobs = [historical, {
    inputs: { documentGenerationSources: { performance: [{ versionId: 'perf-version', clarifiedAt: null }] } },
    createdAt: new Date('2026-11-21T00:00:00Z'),
    result: { generation: { outcomes: [{ type: 'performance', created: 0, errorCount: 0 }] } },
  }];
  const writes = [];
  let job;
  let approvedAt;
  const service = new AutomationService({
    async $transaction(fn) { return fn(this); },
    async $queryRaw() {},
    project: { async findFirst() { return { id: 'project' }; }, async findUniqueOrThrow() { return readyProject; } },
    document: { async findMany() { return docs; } },
    documentAnalysis: {
      async findUnique() {
        return { id: 'analysis', findings: [
          traceableFinding('web-version', { clarification: approvedAt ? { approvedAt } : null }),
          traceableFinding('perf-version'),
        ] };
      },
      async findMany() { return [{ id: 'old-analysis', versions: [{ ...processedVersion, id: 'web-version' }] }]; },
    },
    testScenario: { async count() { return 0; }, async findMany() { return [{ tags: ['@funcional'] }, { tags: ['@manual'] }]; } },
    automationJob: {
      async findMany() { return jobs; },
      async create({ data }) { job = data; writes.push(data); return job; },
      async findFirst({ where }) { return where.id ? job : null; },
      async updateMany({ data }) { writes.push(data); return { count: 1 }; },
    },
  }, {});
  const workspace = { organizationId: null, userId: null };
  const available = await service.availableTypes('project', workspace);
  assert.deepEqual(available.filter(type => type.selectedInDocuments).map(type => type.code), ['functional_web', 'performance', 'manual']);
  const pending = await service.pendingDocumentTypes('project', workspace);
  assert.deepEqual(pending.types, [{ code: 'performance', available: true }]);
  assert.equal(pending.verifiable, 1);
  const create = documentTestTypes => service.create('project', { url: context.url, documentTestTypes }, workspace);
  await assert.rejects(create(['functional_web', 'performance', 'manual']), /tipos pendientes de generación cambiaron/);
  assert.equal(writes.length, 0);
  const created = await create(['performance']);
  assert.equal(created.stage, 'review-ready');
  assert.deepEqual(writes[0].inputs.documentGenerationSources, {
    performance: [{ versionId: 'perf-version', clarifiedAt: null }],
  });
  await assert.rejects(service.select('project', 'job', { types: ['functional_web'] }, workspace), /tipos confirmados/);
  await service.select('project', 'job', { types: ['performance'] }, workspace);
  assert.deepEqual(writes[1].inputs.selection, ['performance']);

  jobs.push({ inputs: writes[1].inputs, createdAt: new Date('2026-11-21T00:00:00Z'),
    result: { generation: { outcomes: [{ type: 'performance', created: 1, errorCount: 0 }] } } });
  assert.deepEqual((await service.pendingDocumentTypes('project', workspace)).types, []);
  await assert.rejects(service.select('project', 'job', { types: ['performance'] }, workspace), /alcance pendiente cambió/);
  approvedAt = '2026-11-22T00:00:00.000Z';
  assert.deepEqual((await service.pendingDocumentTypes('project', workspace)).types.map(type => type.code), ['functional_web', 'manual']);
});

test('el agente de Performance recibe solo requisitos de sus versiones pendientes', async () => {
  const audits = [];
  const outcomes = await runSelectedAgents(['performance'], {
    ...context,
    environmentId: 'environment',
    documentTestTypesConfirmed: true,
    documentGenerationSources: { performance: [{ versionId: 'perf-version', clarifiedAt: null }] },
    requirements: [
      { id: 'web', title: 'Autenticación existente', criteria: [], documentVersionIds: ['web-version'] },
      { id: 'perf', title: 'Latencia del catálogo', criteria: [{ text: 'Mide el p95 en el entorno QA' }], documentVersionIds: ['perf-version'] },
    ],
  }, {
    prisma: { performanceAudit: { async create({ data }) { audits.push(data); } } },
    router: { async dispatch({ prompt }) {
      assert.match(prompt, /Latencia del catálogo/);
      assert.match(prompt, /p95 en el entorno QA/);
      assert.doesNotMatch(prompt, /Autenticación existente/);
      return { model: 'test', text: '{"audits":[{"url":"https://example.test/catalogo","requirementId":"perf"}]}' };
    } },
  });
  assert.deepEqual(outcomes.map(({ type, created }) => [type, created]), [['performance', 1]]);
  assert.equal(audits[0].url, 'https://example.test/catalogo');
  assert.equal(audits[0].requirementId, 'perf');
});

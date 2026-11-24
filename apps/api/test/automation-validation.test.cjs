const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { AutomationValidationService } = require('../dist/quality/automation-validation.service');
const { RunsService } = require('../dist/runs/runs.service');
const { UsageService } = require('../dist/commerce/usage.service');
const { automationSignature } = require('../dist/scenarios/automation-agent');
const { qualityAutomationFile } = require('../dist/scenarios/quality-automation');

const database = process.env.AUTOQA_TEST_DATABASE_URL;
if (!database) throw new Error('Configura AUTOQA_TEST_DATABASE_URL con una base PostgreSQL de pruebas migrada.');

test('valida versiones específicas, rechaza otros proyectos y bloquea escenarios modificados', async t => {
  const db = new PrismaClient({ datasourceUrl: database });
  const secret = 'fixture-secret-for-validation-only';
  const keys = ['AUTOQA_GITHUB_REPO', 'AUTOQA_GITHUB_VALIDATION_TOKEN', 'AUTOQA_VALIDATION_SECRET'];
  const original = keys.map(key => process.env[key]);
  let organizationId;
  let userId;
  t.after(async () => {
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
    try {
      if (organizationId) {
        await db.testRun.deleteMany({ where: { project: { organizationId } } });
        await db.project.deleteMany({ where: { organizationId } });
        await db.organization.delete({ where: { id: organizationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally { await db.$disconnect(); }
  });
  process.env.AUTOQA_GITHUB_REPO = 'example/autoqa';
  process.env.AUTOQA_GITHUB_VALIDATION_TOKEN = 'fixture-github-token';
  process.env.AUTOQA_VALIDATION_SECRET = secret;

  const org = await db.organization.create({ data: {
    name: 'Organización temporal',
    subscription: { create: { planCode: 'professional', status: 'ACTIVE', periodEndsAt: new Date(Date.now() + 3600000) } },
  } });
  organizationId = org.id;
  const user = await db.user.create({ data: {
    name: 'Usuario de prueba', email: randomUUID() + '@example.test',
    membership: { create: { organizationId, role: 'OWNER' } },
  } });
  userId = user.id;
  const workspace = { organizationId, userId, role: 'OWNER' };
  const project = await db.project.create({ data: { organizationId, name: 'Proyecto QA', status: 'READY' } });
  const environment = await db.environment.create({ data: {
    projectId: project.id, type: 'QA', baseUrl: 'https://qa.example.test/', authorizationConfirmed: true,
    authorizedAt: new Date(), allowedHosts: ['qa.example.test'],
  } });
  const steps = [{ ordinal: 1, action: 'navigate: /' }, { ordinal: 2, action: 'expect-visible: h1' }];
  async function scenario(title, testSteps = steps) {
    const source = { title, expectedResult: 'Título visible', steps: testSteps };
    const automation = { id: randomUUID(), title, signature: automationSignature(source), steps: testSteps };
    return db.testScenario.create({ data: { ...source, projectId: project.id, automation } });
  }
  const requested = (await Promise.all([scenario('Caso A'), scenario('Caso B')])).sort((a, b) => a.id < b.id ? -1 : 1);
  const [first, second] = requested;
  const warning = await scenario('Caso con aviso de prueba', [
    { ordinal: 1, action: 'fill: #password', data: 'abc' },
    { ordinal: 2, action: 'expect-visible: h1' },
  ]);
  await db.testScenario.create({ data: { projectId: project.id, title: 'Caso por automatizar', steps } });

  const requirement = await db.requirement.create({ data: { projectId: project.id, title: 'Calidad del catálogo' } });
  const quality = { projectId: project.id, requirementId: requirement.id, environmentId: environment.id, url: 'https://qa.example.test/' };
  const monitor = await db.monitor.create({ data: { ...quality, name: 'Disponibilidad del catálogo' } });
  const lighthouse = await db.performanceAudit.create({ data: quality });
  const load = await db.loadTest.create({ data: { ...quality, name: 'Carga del catálogo', stages: [{ duration: '5s', target: 1 }] } });
  const ux = await db.uxAudit.create({ data: quality });
  const context = {
    projectId: project.id, organizationId, ai: { async dispatch() { return { usedFallback: true, text: '' }; } },
  };
  for (const [kind, resource] of [['availability', monitor], ['lighthouse', lighthouse], ['load', load], ['ux', ux]]) {
    const prepared = await qualityAutomationFile(db, kind, resource.id, project.id, context);
    assert.equal(prepared.prepared, true, JSON.stringify(prepared));
  }
  const runService = new RunsService(db, new UsageService(db), {}, {});
  const service = new AutomationValidationService(db, runService);
  const dispatches = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, 'https://api.github.com/repos/example/autoqa/actions/workflows/validate-automation.yml/dispatches');
    const body = JSON.parse(request.body);
    assert.deepEqual(Object.keys(body.inputs), ['validation_id']);
    dispatches.push(body.inputs.validation_id);
    return new Response(null, { status: 204 });
  });

  const input = { environmentId: environment.id, scenarioIds: [first.id, second.id] };
  await assert.rejects(service.list(project.id, { ...workspace, organizationId: randomUUID() }), { status: 404 });
  const initial = await service.list(project.id, workspace);
  assert.deepEqual({ ...initial.codeHealth, findings: initial.codeHealth.findings.length }, {
    score: 86, analyzed: 7, clean: 6, pending: 1, errors: 0, warnings: 1, findings: 1,
  });
  assert.equal(initial.codeHealth.findings[0].scenarioId, warning.id);
  assert.equal(initial.codeHealth.findings[0].code, 'weak-secret-input');
  assert.doesNotMatch(JSON.stringify(initial.codeHealth), /"abc"|import|qa\.example\.test/);
  assert.equal(initial.ciValidationId, null);
  const started = await service.start(project.id, workspace, input);
  assert.deepEqual(dispatches, [started.id]);
  await assert.rejects(service.start(project.id, workspace, input), { status: 409 });
  await assert.rejects(service.advance(started.id, 'Bearer invalid', '12345'), { status: 403 });
  const startedRun = await service.advance(started.id, 'Bearer ' + secret, '12345');
  assert.equal(startedRun.workflowUrl, 'https://github.com/example/autoqa/actions/runs/12345');
  assert.equal(startedRun.counts.pending, 2);
  await assert.rejects(service.advance(started.id, 'Bearer ' + secret, '12346'), { status: 404 });
  await service.advance(started.id, 'Bearer ' + secret, '12345');
  const queued = await db.testRun.findMany({ where: { projectId: project.id } });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].scenarioId, first.id);
  assert.equal(queued[0].automation.id, first.automation.id);
  assert.match(queued[0].automation.validationScopeSignature, /^[0-9a-f]{64}$/);
  await db.testRun.update({ where: { id: queued[0].id }, data: {
    status: 'COMPLETED', completedAt: new Date(), results: { create: { scenarioId: first.id, status: 'PASSED' } },
  } });
  await db.testScenario.update({ where: { id: second.id }, data: { automation: { ...second.automation, id: randomUUID() } } });
  const stopped = await service.advance(started.id, 'Bearer ' + secret, '12345');
  assert.equal(stopped.status, 'FAILED');
  assert.deepEqual(stopped.counts, { pending: 0, passed: 1, failed: 0, blocked: 1, skipped: 0 });
  assert.equal(stopped.cases[1].automationId, second.automation.id);
  const overview = await service.list(project.id, workspace);
  assert.deepEqual(overview.history[0].counts, stopped.counts);
  assert.equal(overview.history[0].currentVersion, false);
  assert.equal(overview.ciValidationId, null);

  const currentInput = { ...input, scenarioIds: [first.id] };
  const current = await service.start(project.id, workspace, currentInput);
  await service.advance(current.id, 'Bearer ' + secret, '24888');
  const currentJob = await db.automationValidation.findUniqueOrThrow({ where: { id: current.id } });
  await db.testRun.update({ where: { id: currentJob.cases[0].runId }, data: {
    status: 'COMPLETED', completedAt: new Date(), results: { create: { scenarioId: first.id, status: 'PASSED' } },
  } });
  await service.advance(current.id, 'Bearer ' + secret, '24888');
  const reviewed = await service.list(project.id, workspace);
  assert.equal(reviewed.ciValidationId, current.id);
  assert.equal(reviewed.history[0].currentVersion, true);

  const other = await service.start(project.id, workspace, { ...input, scenarioIds: [first.id] });
  await db.environment.update({ where: { id: environment.id }, data: { allowedHosts: ['otro.example.test'] } });
  const changed = await service.advance(other.id, 'Bearer ' + secret, '24689');
  assert.equal(changed.status, 'FAILED');
  assert.equal(changed.counts.blocked, 1);
  assert.equal(await db.testRun.count({ where: { projectId: project.id } }), 2);

  const toCancel = await service.start(project.id, workspace, { ...input, scenarioIds: [first.id] });
  await runService.cancelActive(project.id, workspace);
  const canceled = await service.advance(toCancel.id, 'Bearer ' + secret, '24690');
  assert.equal(canceled.status, 'CANCELED');
});

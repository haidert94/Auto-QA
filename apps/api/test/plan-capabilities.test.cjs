const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { assertMonitorQuota, assertRunQuota } = require('../dist/commerce/usage-quotas');
const { publicPlan, requireCapability } = require('../dist/commerce/plan-capabilities');
const { UsageService } = require('../dist/commerce/usage.service');

const database = process.env.AUTOQA_TEST_DATABASE_URL;
if (!database) throw new Error('Configura AUTOQA_TEST_DATABASE_URL con una base migrada.');
const catalog = [
  { code: 'essentials', price: 210000, apps: 1, roles: 2, parallel: 1, minutes: 100, monitors: 2, interval: 15, loadRuns: 0, vus: null, duration: null, crossBrowser: false },
  { code: 'professional', price: 630000, apps: 3, roles: 5, parallel: 2, minutes: 500, monitors: 10, interval: 5, loadRuns: 0, vus: null, duration: null, crossBrowser: true },
  { code: 'business', price: 1900000, apps: 10, roles: 15, parallel: 4, minutes: 5000, monitors: 50, interval: 1, loadRuns: 20, vus: 100, duration: 10, crossBrowser: true },
];
const teams = [], accounts = [];
let app, db, base;

before(async () => {
  Object.assign(process.env, { DATABASE_URL: database, AUTOQA_LEGACY_MODE: 'false', AUTOQA_DEPLOYMENT: 'local' });
  db = new PrismaClient();
  app = await require('../dist/app').createApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()) + '/api';
});

after(async () => {
  try {
    if (teams.length) {
      await db.project.deleteMany({ where: { organizationId: { in: teams } } });
      await db.organization.deleteMany({ where: { id: { in: teams } } });
    }
    if (accounts.length) await db.user.deleteMany({ where: { id: { in: accounts } } });
  } finally {
    await Promise.all([app?.close(), db?.$disconnect()]);
  }
});

async function request(path, token, method = 'GET', body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(base + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}

async function member(planCode) {
  const end = new Date(Date.now() + 86400000);
  const token = randomBytes(32).toString('hex');
  const user = await db.user.create({
    data: {
      name: 'Equipo de prueba', email: randomUUID() + '@example.com', verifiedAt: new Date(),
      membership: { create: { role: 'OWNER', organization: { create: {
        name: 'Organización de prueba', subscription: { create: { planCode, status: 'ACTIVE', periodEndsAt: end } },
      } } } },
      sessions: { create: { digest: createHash('sha256').update(token).digest('hex'), expiresAt: end } },
    }, include: { membership: true },
  });
  accounts.push(user.id);
  teams.push(user.membership.organizationId);
  return { organizationId: user.membership.organizationId, token };
}

function roleList(count) { return Array.from({ length: count }, (_, index) => ({ name: 'Rol ' + (index + 1) })); }
const emptyCounters = { running: 0, browserSeconds: 0, performanceRuns: 0 };

for (const spec of catalog) {
  test('checks catalog and quota boundaries for ' + spec.code, async () => {
    const plans = await request('/commerce/plans');
    assert.equal(plans.status, 200);
    const plan = plans.body.find(item => item.code === spec.code);
    assert.ok(plan, 'El catálogo debe incluir ' + spec.code);
    assert.deepEqual([plan.priceCop, plan.maxProjects, plan.maxRoles, plan.parallelRuns], [spec.price, spec.apps, spec.roles, spec.parallel]);
    const capability = code => plan.capabilities.find(item => item.code === code);
    const browser = capability('BROWSER_TESTS');
    const monitors = capability('UPTIME_MONITORS');
    const load = capability('LOAD_TESTS');
    assert.deepEqual([browser.monthlyLimit, browser.browsers], [spec.minutes, ['CHROMIUM']]);
    assert.deepEqual([monitors.monitorLimit, monitors.minIntervalMinutes, monitors.availability], [spec.monitors, spec.interval, 'OPERATIONAL']);
    assert.deepEqual([load.monthlyLimit, load.maxVirtualUsers, load.maxDurationMinutes], [spec.loadRuns, spec.vus, spec.duration]);
    assert.equal(load.availability, spec.loadRuns ? 'OPERATIONAL' : 'NOT_INCLUDED');
    assert.equal(capability('DOCUMENT_ANALYSIS').availability, 'OPERATIONAL');
    assert.equal(capability('AI_DOCUMENT_ANALYSIS').availability, 'OPERATIONAL');
    assert.equal(capability('IPA').availability, 'OPERATIONAL');
    assert.equal(capability('ICSP').availability, 'OPERATIONAL');

    const fullBrowser = { kind: 'BROWSER', browser: 'CHROMIUM', browserSeconds: spec.minutes * 60 };
    assert.doesNotThrow(() => assertRunQuota(plan, fullBrowser, { ...emptyCounters, running: spec.parallel - 1 }));
    assert.throws(() => assertRunQuota(plan, fullBrowser, { ...emptyCounters, browserSeconds: 1 }), /minutos/);
    assert.throws(() => assertRunQuota(plan, fullBrowser, { ...emptyCounters, running: spec.parallel }), /simultáneas/);
    const firefox = { kind: 'BROWSER', browser: 'FIREFOX', browserSeconds: 1 };
    if (spec.crossBrowser) assert.doesNotThrow(() => assertRunQuota(plan, firefox, emptyCounters));
    else assert.throws(() => assertRunQuota(plan, firefox, emptyCounters), /Navegador/);

    const { token } = await member(spec.code);
    assert.equal((await request('/projects', token, 'POST', { name: 'Demasiados roles', roles: roleList(spec.roles + 1) })).status, 409);
    for (let index = 0; index < spec.apps; index++) {
      const project = await request('/projects', token, 'POST', { name: 'Aplicación ' + index, roles: roleList(spec.roles) });
      assert.equal(project.status, 201);
    }
    assert.equal((await request('/projects', token, 'POST', { name: 'Aplicación adicional' })).status, 409);
    const summary = await request('/commerce/usage', token);
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body.projects, { used: spec.apps, limit: spec.apps });
    assert.ok(summary.body.roles.projects.every(project => project.used === spec.roles));
  });
}

test('applies legacy quota boundaries to existing subscriptions', async () => {
  const plan = await db.plan.findUniqueOrThrow({ where: { code: 'pro' }, include: { capabilities: true } });
  assert.equal(plan.enabled, false);
  assert.doesNotThrow(() => assertMonitorQuota(plan, 4, 5));
  assert.throws(() => assertMonitorQuota(plan, 5, 5), /límite de monitores/);
  assert.throws(() => assertMonitorQuota(plan, 0, 4), /intervalo/i);

  const candidate = { kind: 'PERFORMANCE', virtualUsers: 10, durationMinutes: 5 };
  assert.throws(() => assertRunQuota(plan, candidate, emptyCounters), /cuota mensual/);
  const performance = plan.capabilities.find(row => row.code === 'PERFORMANCE_TESTS');
  performance.monthlyLimit = 3; // Synthetic value to verify future enforcement.
  performance.availability = 'BETA';
  assert.equal(publicPlan(plan).capabilities.find(row => row.code === 'PERFORMANCE_TESTS').availability, 'UPCOMING');
  assert.throws(() => requireCapability(plan, 'PERFORMANCE_TESTS'), /próximamente/);
  assert.doesNotThrow(() => assertRunQuota(plan, candidate, { ...emptyCounters, performanceRuns: 2 }));
  assert.throws(() => assertRunQuota(plan, candidate, { ...emptyCounters, performanceRuns: 3 }), /cuota mensual/);
  assert.throws(() => assertRunQuota(plan, { ...candidate, virtualUsers: candidate.virtualUsers + 1 }, emptyCounters), /tamaño/);
  assert.throws(() => assertRunQuota(plan, { ...candidate, durationMinutes: candidate.durationMinutes + 1 }, emptyCounters), /duración/);
});

test('keeps existing projects and role counts editable without growing beyond the new plan', async () => {
  const { organizationId, token } = await member('business');
  const roles = roleList(16);
  const existing = await db.project.create({
    data: { organizationId, name: 'Aplicación anterior', roles: { create: roles } },
  });
  const path = '/projects/' + existing.id;
  const preserved = await request(path, token, 'PUT', { name: 'Actualizada', revision: existing.revision, roles });
  assert.equal(preserved.status, 200);
  const increase = await request(path, token, 'PUT', { name: 'Otra revisión', revision: preserved.body.revision, roles: roleList(17) });
  assert.equal(increase.status, 409);
});

test('returns consumption only for the authenticated organization and settles a reservation once', async () => {
  const { organizationId, token } = await member('pro');
  const other = await member('pro');
  const project = await db.project.create({ data: { organizationId, name: 'Propiedad de la organización', status: 'READY' } });
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  await db.meteredRun.createMany({ data: [
    { organizationId, projectId: project.id, runKey: 'completed', kind: 'BROWSER', month, reservedBrowserSeconds: 120, browserSeconds: 78, completedAt: now },
    { organizationId, projectId: project.id, runKey: 'reserved', kind: 'BROWSER', month, reservedBrowserSeconds: 60 },
    { organizationId, projectId: project.id, runKey: 'older', kind: 'BROWSER', month: previousMonth, reservedBrowserSeconds: 200, browserSeconds: 155, completedAt: now },
    { organizationId, projectId: project.id, runKey: 'load-reservation', kind: 'PERFORMANCE', month, reservedBrowserSeconds: 0 },
  ] });
  await db.meteredMonitor.create({ data: { organizationId, projectId: project.id, monitorKey: 'monitor', intervalMinutes: 5 } });

  assert.equal((await request('/commerce/usage')).status, 401);
  const { body: summary } = await request('/commerce/usage?organizationId=' + other.organizationId, token);
  assert.deepEqual(summary.browser, { secondsUsed: 78, secondsReserved: 60, minutesLimit: 1500, availability: 'UPCOMING' });
  assert.deepEqual(summary.runs, { active: 2, simultaneousLimit: 2, completed: 1, availability: 'UPCOMING' });
  assert.equal(summary.performance.used, 1);
  assert.equal(summary.monitors.active, 1);
  assert.equal((await request('/commerce/usage', other.token)).body.browser.secondsUsed, 0);

  const usage = app.get(UsageService);
  await usage.settleRun(organizationId, 'reserved', 37);
  await usage.settleRun(organizationId, 'reserved', 37);
  await assert.rejects(usage.settleRun(organizationId, 'reserved', 39), /no corresponde/);
  await assert.rejects(usage.settleRun(other.organizationId, 'reserved', 37), /no encontrada/);
  await usage.disableMonitor(organizationId, 'monitor');
  const updated = (await request('/commerce/usage', token)).body;
  assert.equal(updated.browser.secondsUsed, 115);
  assert.equal(updated.browser.secondsReserved, 0);
  assert.equal(updated.runs.completed, 2);
  assert.equal(updated.monitors.active, 0);

  await assert.rejects(usage.reserveRun(organizationId, project.id, 'candidate', { kind: 'PERFORMANCE', virtualUsers: 10, durationMinutes: 5 }), /próximamente/);
  await assert.rejects(usage.reserveMonitor(organizationId, project.id, 'candidate', 5), /próximamente/);
});

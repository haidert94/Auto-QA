const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createHash, createHmac, randomBytes, randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { createServer } = require('node:net');
const { clearMessages, mailpitTestEnv, receive } = require('./mailpit.cjs');
const verificationSubject = 'Verifica tu correo de AutoQA';

const database = process.env.AUTOQA_TEST_DATABASE_URL;
if (!database) throw new Error('Configura AUTOQA_TEST_DATABASE_URL con una base migrada.');
const secret = randomBytes(32).toString('hex');
const password = 'prueba-' + randomUUID();
const emails = [], teams = [];
let app, base, db;

before(async () => {
  Object.assign(process.env, {
    DATABASE_URL: database, ...mailpitTestEnv(),
    AUTOQA_PAYMENTS_MODE: 'sandbox', AUTOQA_SANDBOX_PAYMENT_SECRET: secret,
    AUTOQA_TRIAL_DAYS: '0', AUTOQA_LEGACY_MODE: 'false', AUTOQA_DEPLOYMENT: 'local',
  });
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
    if (emails.length) await db.user.deleteMany({ where: { email: { in: emails } } });
  } finally {
    await Promise.all([app?.close(), db?.$disconnect()]);
    for (const email of emails) await clearMessages(email);
  }
});

async function api(path, body, token) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(base + path, {
    headers, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}

async function account() {
  const email = 'qa-' + randomUUID() + '@example.com';
  emails.push(email);
  const registration = await api('/commerce/register', { email, name: 'Cuenta QA', password, plan: 'starter', consentVersion: 'local-1' });
  assert.equal(registration.status, 201, JSON.stringify(registration.body));
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { membership: true } });
  const team = user.membership.organizationId;
  teams.push(team);
  assert.equal((await api('/commerce/login', { email, password })).status, 403);
  const { token: proof } = await receive(email, verificationSubject);
  assert.equal((await api('/commerce/verify', { token: proof })).status, 200);
  assert.equal((await api('/commerce/verify', { token: proof })).status, 400);
  const login = await api('/commerce/login', { email, password });
  assert.equal(login.status, 200);
  return { email, team, token: login.body.token };
}

async function approve(user) {
  assert.equal((await api('/commerce/checkout', { plan: 'starter' }, user.token)).status, 200);
  assert.equal((await api('/commerce/simulate', { outcome: 'approved' }, user.token)).status, 200);
}

test('validates event signature and freshness', () => {
  const { SandboxPaymentProvider } = require('../dist/commerce/payments');
  const provider = new SandboxPaymentProvider();
  const event = { id: randomUUID(), reference: randomBytes(32).toString('hex'), amountCop: 79000, outcome: 'approved', time: Date.now() };
  const sign = payload => createHmac('sha256', secret).update(payload).digest('hex');
  const payload = JSON.stringify(event);
  assert.deepEqual(provider.verify(payload, sign(payload)), event);
  assert.throws(() => provider.verify(payload, '0'.repeat(64)), /Firma/);
  const old = JSON.stringify({ ...event, time: Date.now() - 400000 });
  assert.throws(() => provider.verify(old, sign(old)), /vencido/);
});

test('checks activation, isolation, quota, idempotence and password recovery', async () => {
  assert.deepEqual((await api('/commerce/plans')).body.map(plan => plan.priceCop), [99000, 299000, 899000]);
  assert.equal((await api('/projects')).status, 401);
  const first = await account();
  assert.equal((await api('/projects', undefined, first.token)).status, 403);
  await approve(first);
  assert.equal((await api('/commerce/simulate', { outcome: 'approved' }, first.token)).status, 200);
  assert.equal(await db.payment.count({ where: { subscription: { organizationId: first.team } } }), 1);
  const project = await api('/projects', { name: 'Proyecto A' }, first.token);
  assert.equal(project.status, 201, JSON.stringify(project.body));
  assert.equal((await api('/projects', { name: 'Exceso' }, first.token)).status, 409);
  const other = await account();
  await approve(other);
  assert.deepEqual((await api('/projects', undefined, other.token)).body, []);
  const path = '/projects/' + project.body.id;
  assert.equal((await api(path, undefined, other.token)).status, 404);
  assert.equal((await api(path + '/documents', undefined, other.token)).status, 404);
  assert.equal((await api(path + '/documents', undefined, first.token)).status, 200);
  assert.equal((await api('/commerce/forgot', { email: first.email })).status, 200);
  const { token: reset } = await receive(first.email, 'Restablece tu contraseña de AutoQA');
  const next = 'nueva-' + randomUUID();
  assert.equal((await api('/commerce/reset', { token: reset, password: next })).status, 200);
  assert.equal((await api('/commerce/reset', { token: reset, password: next })).status, 400);
  assert.equal((await api(path, undefined, first.token)).status, 401);
  const login = await api('/commerce/login', { email: first.email, password: next });
  assert.equal(login.status, 200);
  assert.equal((await api('/commerce/cancel', {}, login.body.token)).status, 200);
  assert.equal((await api(path, undefined, login.body.token)).status, 403);
});

test('handles payment failure, trial and expiry', async () => {
  const user = await account();
  assert.equal((await api('/commerce/checkout', { plan: 'starter' }, user.token)).status, 200);
  assert.equal((await api('/commerce/simulate', { outcome: 'failed' }, user.token)).status, 200);
  assert.equal((await api('/commerce/me', undefined, user.token)).body.subscription.status, 'PAYMENT_FAILED');
  assert.equal((await api('/projects', undefined, user.token)).status, 403);
  process.env.AUTOQA_TRIAL_DAYS = '7';
  try {
    assert.equal((await api('/commerce/checkout', { plan: 'starter' }, user.token)).status, 200);
    assert.equal((await api('/commerce/me', undefined, user.token)).body.subscription.status, 'TRIALING');
    assert.equal((await api('/projects', undefined, user.token)).status, 200);
    await db.subscription.update({ where: { organizationId: user.team }, data: { periodEndsAt: new Date(0) } });
    assert.equal((await api('/commerce/me', undefined, user.token)).body.subscription.status, 'EXPIRED');
    assert.equal((await api('/projects', undefined, user.token)).status, 403);
  } finally { process.env.AUTOQA_TRIAL_DAYS = '0'; }
});


test('rotates delivered links, rejects expired links and preserves a valid link on SMTP failure', async () => {
  const email = 'mail-verification-' + randomUUID() + '@example.com';
  emails.push(email);
  assert.equal((await api('/commerce/register', {
    email, name: 'Cuenta de prueba', password, plan: 'starter', consentVersion: 'local-1',
  })).status, 201);
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { membership: true } });
  teams.push(user.membership.organizationId);
  const first = await receive(email, verificationSubject);
  const where = { userId_kind: { userId: user.id, kind: 'VERIFY_EMAIL' } };
  const stored = await db.accountToken.findUniqueOrThrow({ where });
  assert.ok(stored.digest === createHash('sha256').update(first.token).digest('hex'), 'El token debe guardarse como hash.');
  assert.ok(stored.expiresAt > new Date());
  await db.accountToken.update({ where, data: { expiresAt: new Date(0) } });
  assert.equal((await api('/commerce/verify', { token: first.token })).status, 400);
  assert.equal((await api('/commerce/resend', { email })).status, 200);
  const second = await receive(email, verificationSubject, first.id);
  assert.ok(second.token !== first.token);
  assert.equal((await api('/commerce/verify', { token: first.token })).status, 400);

  const rejector = createServer(socket => socket.end('421 Servicio temporalmente no disponible\r\n'));
  await new Promise(resolve => rejector.listen(0, '127.0.0.1', resolve));
  const originalPort = process.env.AUTOQA_SMTP_PORT;
  process.env.AUTOQA_SMTP_PORT = String(rejector.address().port);
  try {
    const failedResend = await api('/commerce/resend', { email });
    assert.equal(failedResend.status, 503);
    assert.match(failedResend.body.message, /no pudo aceptar/);

    const failedEmail = 'mail-unavailable-' + randomUUID() + '@example.com';
    emails.push(failedEmail);
    const failedRegistration = await api('/commerce/register', {
      email: failedEmail, name: 'Registro ante fallo SMTP', password, plan: 'starter', consentVersion: 'local-1',
    });
    assert.equal(failedRegistration.status, 503);
    assert.match(failedRegistration.body.message, /Reenviar verificación/);
    const pending = await db.user.findUniqueOrThrow({ where: { email: failedEmail }, include: { membership: true, accountTokens: true } });
    teams.push(pending.membership.organizationId);
    assert.equal(pending.verifiedAt, null);
    assert.equal(pending.accountTokens.length, 0);
  } finally {
    process.env.AUTOQA_SMTP_PORT = originalPort;
    await new Promise(resolve => rejector.close(resolve));
  }
  const current = await db.accountToken.findUniqueOrThrow({ where });
  assert.ok(current.digest === createHash('sha256').update(second.token).digest('hex'), 'Un reenvío fallido debe conservar el último enlace.');
  const clicks = await Promise.all([
    api('/commerce/verify', { token: second.token }),
    api('/commerce/verify', { token: second.token }),
  ]);
  assert.deepEqual(clicks.map(result => result.status).sort(), [200, 400]);
  assert.equal((await api('/commerce/login', { email, password })).status, 200);
});

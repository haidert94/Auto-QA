const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { chromium } = require('playwright-core');
const { PrismaClient } = require('@prisma/client');
const { clearMessages, mailpitTestEnv, receive } = require('../../api/test/mailpit.cjs');

const database = process.env.AUTOQA_TEST_DATABASE_URL;
if (!database) throw new Error('Configura AUTOQA_TEST_DATABASE_URL con una base migrada.');
const website = 'http://localhost:3100';
const backend = 'http://127.0.0.1:3101/api';
const email = 'prueba-' + randomUUID() + '@example.com';
const password = 'qa-' + randomUUID();
const db = new PrismaClient({ datasourceUrl: database });

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2500) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('No respondió ' + url);
}

async function run() {
  const env = { ...process.env, DATABASE_URL: database, PORT: '3101', NEXT_TELEMETRY_DISABLED: '1',
    ...mailpitTestEnv(), AUTOQA_LEGACY_MODE: 'false',
    AUTOQA_ACCOUNT_ORIGIN: website, AUTOQA_INTERNAL_API_URL: backend, AUTOQA_DEPLOYMENT: 'local',
    AUTOQA_TRIAL_DAYS: '0', AUTOQA_PAYMENTS_MODE: 'sandbox', AUTOQA_SANDBOX_PAYMENT_SECRET: randomBytes(32).toString('hex'),
  };
  const backendProcess = spawn(process.execPath, ['apps/api/dist/main.js'], { env, windowsHide: true, stdio: 'inherit' });
  const frontendProcess = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '3100'],
    { cwd: 'apps/web', env, windowsHide: true, stdio: 'inherit' });
  let browser;
  try {
    await Promise.all([waitFor(website, frontendProcess), waitFor(backend + '/commerce/plans', backendProcess)]);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(website);
    await page.getByRole('heading', { name: /Automatiza tus pruebas/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.getByLabel('Abrir menú').click();
    await page.getByRole('navigation', { name: 'Navegación móvil' }).getByText('Precios', { exact: true }).waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await page.getByRole('link', { name: 'Elegir plan' }).count(), 3);
    const comparison = page.getByRole('region', { name: 'Comparación de planes' });
    await comparison.getByRole('row', { name: /Monitores HTTP/ }).getByText('10 cada minuto').waitFor();
    await comparison.getByRole('row', { name: /Pruebas de performance/ }).getByText(/100 usuarios virtuales/).waitFor();
    assert.equal(await comparison.getByRole('row', { name: /Pruebas de performance/ }).getByText('Próximamente', { exact: true }).count(), 2);
    assert.equal(await comparison.getByRole('row', { name: /Preparación documental/ }).getByText('Operativa', { exact: true }).count(), 3);
    await page.getByText('$299.000', { exact: true }).waitFor();
    await page.locator('.plan-card').filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) })
      .getByRole('link', { name: 'Elegir plan' }).click();
    await page.waitForURL('**/registro?plan=pro');
    assert.equal(await page.getByRole('combobox').inputValue(), 'pro');
    await page.getByLabel('Nombre completo').fill('Equipo sintético');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Crear mi cuenta' }).click();
    await page.getByText(/mensaje de verificación/).waitFor();
    await page.getByRole('link', { name: 'Abrir buzón de desarrollo en Mailpit' }).waitFor();
    const delivery = await receive(email, 'Verifica tu correo de AutoQA');
    await page.goto(delivery.url);
    await page.getByRole('button', { name: 'Verificar correo' }).click();
    await page.getByText(/Correo verificado/).waitFor();
    await page.goto(website + '/login');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.waitForURL('**/billing');
    await page.getByRole('heading', { name: 'Consumo del plan' }).waitFor();
    const cookie = (await page.context().cookies()).find(item => item.name === 'autoqa_session');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Lax');
    await page.getByRole('button', { name: 'Iniciar contratación' }).click();
    await page.getByRole('button', { name: 'Simular aprobación' }).click();
    await page.getByRole('link', { name: 'Entrar al dashboard' }).click();
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
    await page.getByRole('link', { name: 'Registrar aplicación' }).click();
    await page.getByLabel('Nombre de la aplicación').fill('Aplicación E2E');
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    await page.getByRole('heading', { name: 'Aplicación E2E' }).waitFor();
    console.log('E2E correcto: móvil, plan, registro, verificación, pago simulado, dashboard y primer proyecto.');
  } finally {
    await browser?.close();
    backendProcess.kill(); frontendProcess.kill();
    const user = await db.user.findUnique({ where: { email }, include: { membership: true } });
    if (user?.membership) {
      await db.project.deleteMany({ where: { organizationId: user.membership.organizationId } });
      await db.organization.delete({ where: { id: user.membership.organizationId } });
    }
    if (user) await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
    await clearMessages(email);
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });

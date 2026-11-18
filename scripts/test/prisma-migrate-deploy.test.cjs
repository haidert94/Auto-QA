const assert = require('node:assert/strict');
const { test } = require('node:test');
const { migrationConnection, redact, runMigrations } = require('../prisma-migrate-deploy.cjs');

const pooled = 'postgresql://synthetic:p%40ss-test@ep-demo-name-pooler.c-15.us-east-1.aws.neon.tech/neondb?sslmode=require&schema=public&pgbouncer=true';
const direct = pooled.replace('-pooler.', '.').replace('&pgbouncer=true', '');
const lockError = { status: 1, stdout: '', stderr: 'Error: P1002\nTimed out trying to acquire a postgres advisory lock (SELECT pg_advisory_lock(72707369)).' };

test('Neon: usa conexión directa, conserva TLS, base, esquema y contraseña codificada sin mutar el entorno', () => {
  const env = { DATABASE_URL: pooled };
  const result = migrationConnection(env);
  assert.equal(result.url, direct);
  assert.equal(result.mode, 'directa Neon');
  assert.equal(env.DATABASE_URL, pooled);
});

test('DIRECT_URL tiene prioridad; admite una identidad de administración en el mismo endpoint', () => {
  const admin = direct.replace('synthetic:', 'migration_admin:');
  assert.equal(migrationConnection({ DATABASE_URL: pooled, DIRECT_URL: admin, DATABASE_URL_UNPOOLED: 'invalid' }).url, admin);
  assert.equal(migrationConnection({ DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct }).url, direct);
  assert.equal(migrationConnection({ DATABASE_URL: pooled, DIRECT_URL: direct.replace('/neondb', ':5432/neondb') }).url,
    direct.replace('/neondb', ':5432/neondb'));
});

test('PostgreSQL local y hosts ajenos a Neon se conservan sin adivinar conexiones', () => {
  for (const url of ['postgresql://qa:synthetic@127.0.0.1:5432/autoqa?schema=public',
    'postgresql://qa:synthetic@ep-demo-pooler.example.test/autoqa',
    'postgresql://qa:synthetic@ep-demo-pooler.aws.neon.tech.example.test/autoqa']) {
    assert.equal(migrationConnection({ DATABASE_URL: url }).url, url);
  }
});

test('rechaza configuración inválida y conexión directa que cambia el destino o sigue usando el pooler', () => {
  for (const url of [undefined, '', 'invalid', 'https://example.test/autoqa', 'postgresql://localhost/']) {
    assert.throws(() => migrationConnection({ DATABASE_URL: url }));
  }
  for (const url of [pooled, direct.replace('/neondb', '/other'), direct.replace('schema=public', 'schema=other'),
    direct.replace('ep-demo-name.', 'ep-other.')]) {
    assert.throws(() => migrationConnection({ DATABASE_URL: pooled, DIRECT_URL: url }));
  }
});

test('redacta URLs y contraseñas codificadas o decodificadas en la salida', () => {
  const output = redact(`${pooled}\n${direct}\np%40ss-test\np@ss-test\nError P1002`, [pooled, direct]);
  for (const secret of [pooled, direct, 'p%40ss-test', 'p@ss-test']) assert.ok(!output.includes(secret));
  assert.ok(output.includes('P1002'));
});

test('éxito: ejecuta una sola vez y pasa la conexión directa sólo al proceso hijo', async () => {
  const env = { DATABASE_URL: pooled, KEEP: 'yes' };
  const seen = [];
  assert.equal(await runMigrations({ env, log() {}, run(child) { seen.push(child); return { status: 0, stdout: 'No pending migrations.' }; } }), 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].DATABASE_URL, direct);
  assert.equal(seen[0].KEEP, 'yes');
  assert.equal(seen[0].PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK, undefined);
  assert.equal(env.DATABASE_URL, pooled);
});

test('reintenta P1002 advisory lock y termina al primer éxito', async () => {
  const waits = []; let attempts = 0;
  const code = await runMigrations({ env: { DATABASE_URL: pooled }, log() {}, delay: async ms => waits.push(ms),
    run() { return ++attempts === 1 ? lockError : { status: 0 }; } });
  assert.equal(code, 0); assert.equal(attempts, 2); assert.deepEqual(waits, [2000]);
});

test('mantiene el fallo después de tres bloqueos; no declara éxito ni salta migraciones', async () => {
  const waits = []; let attempts = 0;
  const code = await runMigrations({ env: { DATABASE_URL: pooled }, log() {}, delay: async ms => waits.push(ms),
    run() { attempts++; return lockError; } });
  assert.equal(code, 1); assert.equal(attempts, 3); assert.deepEqual(waits, [2000, 4000]);
});

test('reconoce el bloqueo aunque Prisma coloree el código de error', async () => {
  let attempts = 0;
  const code = await runMigrations({ env: { DATABASE_URL: pooled }, log() {}, delay: async () => {},
    run() { return ++attempts === 1 ? { status: 1, stderr: '\x1b[31mP1002\x1b[0m pg_advisory_lock' } : { status: 0 }; } });
  assert.equal(code, 0); assert.equal(attempts, 2);
});

test('no reintenta fallos SQL, de red, de proceso o un P1002 ajeno al bloqueo', async () => {
  for (const result of [{ status: 7, stderr: 'P3009 failed migration' }, { status: 1, stderr: 'P1001 connection failed' },
    { status: 1, stderr: 'P1002 other timeout' }, { status: null, error: new Error('spawn failed') }]) {
    let attempts = 0;
    const code = await runMigrations({ env: { DATABASE_URL: pooled }, log() {}, delay: async () => assert.fail('No debe esperar'),
      run() { attempts++; return result; } });
    assert.equal(code, result.status || 1); assert.equal(attempts, 1);
  }
});

test('salida del runner saneada incluso cuando el proceso falla', async () => {
  const lines = [];
  await runMigrations({ env: { DATABASE_URL: pooled }, log: text => lines.push(text),
    run() { return { status: 1, stderr: `P1001 ${direct} p@ss-test` }; } });
  assert.ok(!lines.join('\n').includes('p@ss-test'));
  assert.ok(!lines.join('\n').includes('p%40ss-test'));
});

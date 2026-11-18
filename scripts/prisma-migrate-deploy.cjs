const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');
const { setTimeout: sleep } = require('node:timers/promises');

const root = resolve(__dirname, '..');
const pooledNeon = hostname => /^ep-[a-z0-9-]+-pooler\..+\.neon\.tech$/i.test(hostname);
const neon = hostname => hostname.endsWith('.neon.tech');

function databaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Configura una conexión PostgreSQL válida para las migraciones.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error('Configura una conexión PostgreSQL con host y nombre de base de datos.');
  }
  return url;
}

function migrationConnection(env) {
  const runtime = databaseUrl(env.DATABASE_URL);
  const explicit = env.DIRECT_URL?.trim() || env.DATABASE_URL_UNPOOLED?.trim();
  const url = explicit ? databaseUrl(explicit) : new URL(runtime.href);
  if (explicit) {
    if (pooledNeon(url.hostname)) throw new Error('DIRECT_URL / DATABASE_URL_UNPOOLED debe usar la conexión Neon sin pooler.');
    const runtimeHost = runtime.hostname.replace('-pooler.', '.');
    if (url.pathname !== runtime.pathname || (url.searchParams.get('schema') ?? 'public') !== (runtime.searchParams.get('schema') ?? 'public')
      || (neon(runtime.hostname) && (url.hostname !== runtimeHost || (url.port || '5432') !== (runtime.port || '5432')))) {
      throw new Error('La conexión directa debe apuntar a la misma base, esquema y endpoint Neon que DATABASE_URL.');
    }
  } else if (pooledNeon(runtime.hostname)) {
    // Neon publishes the unpooled endpoint under the same hostname without -pooler.
    // This affects the CLI child only; Prisma Client keeps DATABASE_URL unchanged.
    url.hostname = runtime.hostname.replace('-pooler.', '.');
  }
  if (neon(url.hostname)) url.searchParams.delete('pgbouncer');
  return { url: url.href, mode: explicit ? 'directa explícita' : pooledNeon(runtime.hostname) ? 'directa Neon' : 'DATABASE_URL' };
}

function redact(output, urls) {
  let safe = String(output ?? '');
  const secrets = [];
  for (const raw of urls.filter(Boolean)) {
    safe = safe.split(raw).join('[URL de base de datos omitida]');
    try {
      const password = new URL(raw).password;
      if (password) { secrets.push(password); try { secrets.push(decodeURIComponent(password)); } catch {} }
    } catch {}
  }
  safe = safe.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[URL de base de datos omitida]');
  for (const secret of [...new Set(secrets)].sort((a, b) => b.length - a.length)) safe = safe.split(secret).join('[secreto omitido]');
  return safe;
}

function execute(env) {
  return spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
}

async function runMigrations({ env, run = execute, delay = sleep, log = console.log }) {
  const connection = migrationConnection(env);
  const childEnv = { ...env, DATABASE_URL: connection.url };
  const urls = [env.DATABASE_URL, env.DIRECT_URL, env.DATABASE_URL_UNPOOLED, connection.url];
  log(`[migrate] Conexión para Prisma CLI: ${connection.mode}. La conexión de la aplicación se conserva.`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run(childEnv);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (output.trim()) log(redact(output.trim(), urls));
    if (!result.error && result.status === 0) return 0;
    const diagnostic = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    const lockTimeout = /\bP1002\b/.test(diagnostic) && /pg_advisory_lock|advisory lock/i.test(diagnostic);
    if (result.error || !lockTimeout || attempt === 3) {
      log('[migrate] No se completaron las migraciones. El build se detiene; no se omite ninguna migración.');
      return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    }
    log(`[migrate] Bloqueo de migraciones ocupado. Reintento ${attempt + 1}/3; se mantiene el bloqueo de seguridad.`);
    await delay(attempt * 2000);
  }
  return 1;
}

function configuration(env = process.env) {
  let local = {};
  try { local = parseEnv(readFileSync(resolve(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('No se pudo leer la configuración local de migraciones.'); }
  return { ...local, ...env };
}

if (require.main === module) {
  Promise.resolve().then(() => runMigrations({ env: configuration() }))
    .then(code => { process.exitCode = code; })
    .catch(() => {
      console.error('[migrate] Configuración o ejecución inválida. Comprueba DATABASE_URL y, si existe, DIRECT_URL. No se mostraron credenciales.');
      process.exitCode = 1;
    });
}
module.exports = { migrationConnection, redact, runMigrations, configuration };

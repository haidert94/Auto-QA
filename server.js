// Entry file para Hostinger Express app_type.
// Corre todo en UN solo proceso Node.js:
//   1. Aplica migraciones de Prisma.
//   2. Levanta la API NestJS en 127.0.0.1:apiPort (loopback, no expuesta).
//   3. Levanta Next.js como custom server en 0.0.0.0:$PORT (el que Hostinger provee).
// Hostinger espera que el proceso del entry_file escuche en $PORT; si usamos
// spawn para procesos hijos, Hostinger no detecta el listener y devuelve 503.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const publicPort = Number(process.env.PORT || 8080);
const apiPort = 4001;

async function main() {
  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (migrate.status !== 0) {
    console.error('[startup] prisma migrate deploy falló; continúo igual');
  }

  process.env.AUTOQA_INTERNAL_API_URL = `http://127.0.0.1:${apiPort}/api`;

  // Next.js PRIMERO: Hostinger enruta al primer puerto detectado por el proceso.
  console.log('[startup] Iniciando Next.js en 0.0.0.0:' + publicPort);
  const next = require('next');
  const webApp = next({ dev: false, dir: path.join(__dirname, 'apps', 'web') });
  const handle = webApp.getRequestHandler();
  await webApp.prepare();

  await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handle(req, res));
    server.once('error', reject);
    server.listen(publicPort, '0.0.0.0', () => {
      console.log('[startup] Next.js escuchando en', publicPort);
      resolve();
    });
  });

  // NestJS DESPUÉS en loopback. Si el proxy de Hostinger detecta el primer
  // listener, ya tomó el de Next.js arriba.
  console.log('[startup] Iniciando API NestJS en loopback', apiPort);
  const { createApp } = require(path.join(__dirname, 'apps', 'api', 'dist', 'app.js'));
  const nest = await createApp();
  await nest.listen(apiPort, '127.0.0.1');
  console.log('[startup] API lista en 127.0.0.1:' + apiPort);
}

main().catch((err) => {
  console.error('[startup] Error fatal:', err);
  process.exit(1);
});

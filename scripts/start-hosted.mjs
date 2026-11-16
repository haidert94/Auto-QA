// Arranque de un solo contenedor: aplica migraciones, levanta la API en loopback
// (127.0.0.1:4001, nunca expuesta) y Next.js en el puerto público ($PORT).
import { spawn, spawnSync } from 'node:child_process';

const publicPort = process.env.PORT || '8080';
const apiPort = '4001';
const sh = process.platform === 'win32';

const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: sh });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const api = spawn('node', ['apps/api/dist/main.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: apiPort },
});
const web = spawn('npx', ['next', 'start', '-H', '0.0.0.0', '-p', publicPort], {
  stdio: 'inherit', cwd: 'apps/web', shell: sh,
  env: { ...process.env, AUTOQA_INTERNAL_API_URL: `http://127.0.0.1:${apiPort}/api` },
});

const stop = (code) => { api.kill(); web.kill(); process.exit(code ?? 1); };
api.on('exit', stop);
web.on('exit', stop);
process.on('SIGTERM', () => stop(0));

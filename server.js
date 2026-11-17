// Entry point para Hostinger Node.js app_type=express.
// Hostinger solo permite UN server.listen() por proceso y exige que se
// invoque dentro de los primeros ~3 segundos. Por eso montamos NestJS
// como un handler de /api/* y Next.js para el resto en un único http
// server. Las migraciones de Prisma corren en el build, no acá.

const http = require('node:http');
const path = require('node:path');

const publicPort = Number(process.env.PORT || 8080);

async function main() {
  // Las SSR routes y los handlers /api/* del lado web usan esta URL;
  // apuntan al mismo proceso, loopback HTTP → handler de NestJS.
  process.env.AUTOQA_INTERNAL_API_URL = 'http://127.0.0.1:' + publicPort + '/api';

  console.log('[startup] cargando NestJS');
  const { createApp } = require(path.join(__dirname, 'apps', 'api', 'dist', 'app.js'));
  const nest = await createApp();
  await nest.init(); // init sin listen: deja el Express adapter listo
  const nestHandler = nest.getHttpAdapter().getInstance();

  console.log('[startup] cargando Next.js');
  const next = require('next');
  const webApp = next({ dev: false, dir: path.join(__dirname, 'apps', 'web') });
  const nextHandle = webApp.getRequestHandler();
  await webApp.prepare();

  const server = http.createServer((req, res) => {
    if (req.url && (req.url === '/api' || req.url.startsWith('/api/') || req.url.startsWith('/api?'))) {
      nestHandler(req, res);
    } else {
      nextHandle(req, res);
    }
  });

  server.listen(publicPort, '0.0.0.0', () => {
    console.log('[startup] server escuchando en 0.0.0.0:' + publicPort);
  });
}

main().catch((err) => {
  console.error('[startup] Error fatal:', err);
  process.exit(1);
});

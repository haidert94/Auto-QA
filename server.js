// Entry point para Hostinger Node.js app_type=express.
// Un solo listen() por proceso (restricción de Hostinger). NestJS y
// Next.js comparten el mismo http.Server: /api/* lo maneja NestJS, el
// resto Next.js. Las migraciones de Prisma corren en el build.
//
// Loopback bloqueado: en este runtime, un `fetch('http://127.0.0.1:PORT/...')`
// desde el mismo proceso Node devuelve `TypeError: fetch failed` (el
// proxy frontal no habilita el intra-process a la propia dirección).
// Para que la SSR de Next siga llamando al contrato HTTP de NestJS sin
// cambiar su código, parcheamos `globalThis.fetch`: cuando el host es
// el loopback público, invocamos el handler Express de NestJS con un
// `req`/`res` sintéticos. NestJS sigue corriendo sus guards, pipes y
// validaciones; el frontend no toca Prisma directamente.

const http = require('node:http');
const path = require('node:path');
const { PassThrough, Readable } = require('node:stream');

const publicPort = Number(process.env.PORT || 8080);
const loopbackHosts = new Set([
  '127.0.0.1:' + publicPort,
  'localhost:' + publicPort,
]);

async function main() {
  process.env.AUTOQA_INTERNAL_API_URL = 'http://127.0.0.1:' + publicPort + '/api';

  console.log('[startup] cargando NestJS');
  const { createApp } = require(path.join(__dirname, 'apps', 'api', 'dist', 'app.js'));
  const nest = await createApp();
  await nest.init();
  const nestHandler = nest.getHttpAdapter().getInstance();

  installLoopbackFetch(nestHandler);

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

function installLoopbackFetch(nestHandler) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function patchedFetch(input, init) {
    let urlString;
    try {
      urlString = typeof input === 'string' ? input
        : (input && typeof input === 'object' && 'url' in input) ? input.url
        : String(input);
      const u = new URL(urlString);
      if (loopbackHosts.has(u.host)) {
        return await nestInProcessFetch(nestHandler, u, init ?? {});
      }
    } catch { /* cae al fetch original */ }
    return originalFetch(input, init);
  };
}

// Invoca el handler Express de NestJS en el mismo proceso usando un par
// req/res sintéticos. No abre socket TCP alguno.
async function nestInProcessFetch(handler, url, init) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = Object.create(null);
  if (init.headers) {
    const h = new Headers(init.headers);
    for (const [k, v] of h.entries()) headers[k.toLowerCase()] = v;
  }
  headers.host = url.host;

  const bodyBuffer = await toBuffer(init.body);
  if (bodyBuffer && !headers['content-length']) {
    headers['content-length'] = String(bodyBuffer.length);
  }

  return new Promise((resolveFn, rejectFn) => {
    const req = bodyBuffer ? Readable.from([bodyBuffer]) : Readable.from([]);
    req.method = method;
    req.url = url.pathname + url.search;
    req.headers = headers;
    req.rawHeaders = Object.entries(headers).flatMap(([k, v]) => [k, String(v)]);
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.socket = { remoteAddress: '127.0.0.1', encrypted: false, destroyed: false };
    req.connection = req.socket;

    const chunks = [];
    const outHeaders = Object.create(null);
    let statusCode = 200;
    let statusMessage = 'OK';
    let headersSent = false;
    let finished = false;

    const res = new PassThrough();
    res.statusCode = statusCode;
    res.setHeader = (name, value) => { outHeaders[String(name).toLowerCase()] = value; return res; };
    res.getHeader = (name) => outHeaders[String(name).toLowerCase()];
    res.getHeaders = () => ({ ...outHeaders });
    res.getHeaderNames = () => Object.keys(outHeaders);
    res.hasHeader = (name) => Object.prototype.hasOwnProperty.call(outHeaders, String(name).toLowerCase());
    res.removeHeader = (name) => { delete outHeaders[String(name).toLowerCase()]; };
    res.flushHeaders = () => { headersSent = true; };
    res.writeHead = function (code, maybeMessage, maybeHeaders) {
      statusCode = code;
      res.statusCode = code;
      let hdrs = maybeHeaders;
      if (typeof maybeMessage === 'string') statusMessage = maybeMessage;
      else if (maybeMessage && typeof maybeMessage === 'object') hdrs = maybeMessage;
      if (hdrs) {
        if (Array.isArray(hdrs)) {
          for (let i = 0; i < hdrs.length; i += 2) res.setHeader(hdrs[i], hdrs[i + 1]);
        } else {
          for (const [k, v] of Object.entries(hdrs)) res.setHeader(k, v);
        }
      }
      headersSent = true;
      return res;
    };
    Object.defineProperty(res, 'headersSent', { get: () => headersSent });

    res.write = function (chunk, enc, cb) {
      headersSent = true;
      if (chunk != null && chunk.length !== 0) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
      }
      if (typeof cb === 'function') process.nextTick(cb);
      return true;
    };
    res.end = function (chunk, enc, cb) {
      if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
      else if (typeof enc === 'function') { cb = enc; enc = undefined; }
      if (chunk != null && chunk.length !== 0) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
      }
      if (!finished) {
        finished = true;
        const body = Buffer.concat(chunks);
        const respHeaders = new Headers();
        for (const [k, v] of Object.entries(outHeaders)) {
          if (Array.isArray(v)) v.forEach(x => respHeaders.append(k, String(x)));
          else if (v != null) respHeaders.set(k, String(v));
        }
        // Response reconstruye estos encabezados por sí misma.
        respHeaders.delete('content-length');
        respHeaders.delete('transfer-encoding');
        resolveFn(new Response(body.length === 0 ? null : body, {
          status: statusCode, statusText: statusMessage, headers: respHeaders,
        }));
      }
      if (typeof cb === 'function') process.nextTick(cb);
      return res;
    };
    res.on('error', rejectFn);

    try { handler(req, res); }
    catch (e) { rejectFn(e); }
  });
}

async function toBuffer(body) {
  if (body == null) return null;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return Buffer.from(body.toString(), 'utf8');
  }
  // Web ReadableStream (lo que usa Next 15 para request.body en rutas API)
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return await drainWebStream(body);
  }
  // Node Readable (por si llega uno)
  if (body && typeof body.pipe === 'function' && typeof body.on === 'function') {
    return await drainNodeStream(body);
  }
  // Blob/File tienen arrayBuffer()
  if (body && typeof body.arrayBuffer === 'function') {
    try { return Buffer.from(await body.arrayBuffer()); } catch {}
  }
  try { return Buffer.from(String(body), 'utf8'); }
  catch { return null; }
}

async function drainWebStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    }
  } finally { try { reader.releaseLock(); } catch {} }
  return Buffer.concat(chunks);
}

function drainNodeStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

main().catch((err) => {
  console.error('[startup] Error fatal:', err);
  process.exit(1);
});

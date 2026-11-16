// Prueba performCheck contra un servidor HTTP local. No requiere BD.

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createServer } = require('node:http');

// El runner vive en apps/explorer; lo compilamos a dist/explorer/src/monitor-runner.js
const { performCheck } = require('../../explorer/dist/explorer/src/monitor-runner');

let server;
let port;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200); res.end('ok'); return; }
    if (req.url === '/not-found') { res.writeHead(404); res.end('nope'); return; }
    if (req.url === '/server-error') { res.writeHead(500); res.end('boom'); return; }
    if (req.url === '/slow') {
      setTimeout(() => { res.writeHead(200); res.end('late'); }, 500);
      return;
    }
    res.writeHead(200); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => new Promise(resolve => server.close(() => resolve())));

test('performCheck: 200 → status UP con latencia medida', async () => {
  const outcome = await performCheck(`http://127.0.0.1:${port}/ok`, 3000);
  assert.equal(outcome.status, 'UP');
  assert.equal(outcome.httpStatus, 200);
  assert.equal(outcome.errorCode, null);
  assert.ok(outcome.latencyMs !== null && outcome.latencyMs >= 0);
});

test('performCheck: 404 → status DOWN con errorCode http-404', async () => {
  const outcome = await performCheck(`http://127.0.0.1:${port}/not-found`, 3000);
  assert.equal(outcome.status, 'DOWN');
  assert.equal(outcome.httpStatus, 404);
  assert.equal(outcome.errorCode, 'http-404');
});

test('performCheck: 500 → DOWN', async () => {
  const outcome = await performCheck(`http://127.0.0.1:${port}/server-error`, 3000);
  assert.equal(outcome.status, 'DOWN');
  assert.equal(outcome.httpStatus, 500);
  assert.equal(outcome.errorCode, 'http-500');
});

test('performCheck: timeout → DOWN con httpStatus null', async () => {
  const outcome = await performCheck(`http://127.0.0.1:${port}/slow`, 100);
  assert.equal(outcome.status, 'DOWN');
  assert.equal(outcome.httpStatus, null);
  assert.ok(outcome.errorCode !== null);
});

test('performCheck: URL inválida → DOWN con errorCode legible', async () => {
  const outcome = await performCheck('not a url', 1000);
  assert.equal(outcome.status, 'DOWN');
  assert.equal(outcome.httpStatus, null);
});

test('performCheck: puerto cerrado → DOWN', async () => {
  // Puerto 1 casi siempre está cerrado.
  const outcome = await performCheck('http://127.0.0.1:1/', 1500);
  assert.equal(outcome.status, 'DOWN');
  assert.equal(outcome.httpStatus, null);
  assert.ok(outcome.errorCode);
});

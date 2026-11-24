// Pruebas unitarias del adaptador S3. No tocan red: se mockea el S3Client
// enviando a mano respuestas de éxito / NoSuchKey / errores genéricos.
//
// Comparten el mismo mecanismo para el reader del API y el storage del
// worker, porque los dos usan apps/api/src/exploration/s3-config.ts.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Readable } = require('node:stream');
const { mkdtemp, mkdir, rmdir, symlink, unlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { isS3Enabled, readS3Config, resolveObjectKey } = require('../dist/exploration/s3-config');
const { LocalScreenshotReader, S3ScreenshotReader } = require('../dist/exploration/screenshot-storage');

const { NoSuchKey, S3ServiceException } = require('@aws-sdk/client-s3');

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Mock mínimo: capturamos el comando enviado y devolvemos lo que el test pida.
function makeClient(behavior) {
  return {
    sent: [],
    send(command) {
      this.sent.push(command);
      return behavior(command);
    },
  };
}

function asBody(buffer) {
  const stream = Readable.from([buffer]);
  stream.transformToByteArray = async () => new Uint8Array(buffer);
  return stream;
}

test('el lector local devuelve únicamente archivos de evidencia válidos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'autoqa-reader-'));
  const key = 'a'.repeat(32);
  const directory = 'b'.repeat(32);
  const link = 'c'.repeat(32);
  try {
    await writeFile(join(dir, key), 'evidencia');
    await mkdir(join(dir, directory));
    const reader = withEnv({ AUTOQA_EXPLORATIONS_DIR: dir }, () => new LocalScreenshotReader());
    assert.equal((await reader.read(key)).toString(), 'evidencia');
    assert.equal(await reader.read(directory), null);
    assert.equal(await reader.read('d'.repeat(32)), null);
    assert.equal(await reader.read('evidencia-inválida'), null);
    if (process.platform !== 'win32') {
      await symlink(join(dir, key), join(dir, link));
      assert.equal(await reader.read(link), null);
    }
  } finally {
    if (process.platform !== 'win32') await unlink(join(dir, link)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await unlink(join(dir, key));
    await rmdir(join(dir, directory));
    await rmdir(dir);
  }
});

test('isS3Enabled reconoce AUTOQA_EXPLORATIONS_BACKEND=s3', () => {
  withEnv({ AUTOQA_EXPLORATIONS_BACKEND: 's3' }, () => assert.equal(isS3Enabled(), true));
  withEnv({ AUTOQA_EXPLORATIONS_BACKEND: 'local' }, () => assert.equal(isS3Enabled(), false));
  withEnv({ AUTOQA_EXPLORATIONS_BACKEND: undefined }, () => assert.equal(isS3Enabled(), false));
  withEnv({ AUTOQA_EXPLORATIONS_BACKEND: 'S3' }, () => assert.equal(isS3Enabled(), true));
});

test('readS3Config exige todas las variables obligatorias', () => {
  withEnv({
    AUTOQA_S3_ENDPOINT: undefined, AUTOQA_S3_REGION: undefined, AUTOQA_S3_BUCKET: undefined,
    AUTOQA_S3_ACCESS_KEY: undefined, AUTOQA_S3_SECRET_KEY: undefined,
  }, () => assert.throws(() => readS3Config(), /falta configuración/));

  withEnv({
    AUTOQA_S3_ENDPOINT: 'https://example.com', AUTOQA_S3_REGION: 'auto',
    AUTOQA_S3_BUCKET: 'b', AUTOQA_S3_ACCESS_KEY: 'k',
    AUTOQA_S3_SECRET_KEY: undefined,
  }, () => assert.throws(() => readS3Config(), /falta configuración/));
});

test('readS3Config rechaza endpoint no válido', () => {
  withEnv({
    AUTOQA_S3_ENDPOINT: 'no-es-url', AUTOQA_S3_REGION: 'auto',
    AUTOQA_S3_BUCKET: 'b', AUTOQA_S3_ACCESS_KEY: 'k', AUTOQA_S3_SECRET_KEY: 's',
  }, () => assert.throws(() => readS3Config(), /URL válida/));
});

test('readS3Config rechaza prefix que empieza con "/"', () => {
  withEnv({
    AUTOQA_S3_ENDPOINT: 'https://example.com', AUTOQA_S3_REGION: 'auto',
    AUTOQA_S3_BUCKET: 'b', AUTOQA_S3_ACCESS_KEY: 'k', AUTOQA_S3_SECRET_KEY: 's',
    AUTOQA_S3_PREFIX: '/prod/',
  }, () => assert.throws(() => readS3Config(), /no debe empezar/));
});

test('readS3Config normaliza prefix sin barra final', () => {
  const config = withEnv({
    AUTOQA_S3_ENDPOINT: 'https://example.com', AUTOQA_S3_REGION: 'auto',
    AUTOQA_S3_BUCKET: 'b', AUTOQA_S3_ACCESS_KEY: 'k', AUTOQA_S3_SECRET_KEY: 's',
    AUTOQA_S3_PREFIX: 'prod',
    AUTOQA_S3_FORCE_PATH_STYLE: 'true',
  }, () => readS3Config());
  assert.equal(config.prefix, 'prod/');
  assert.equal(config.forcePathStyle, true);
});

test('resolveObjectKey rechaza claves que no son hex-32', () => {
  const config = { prefix: 'prod/' };
  assert.equal(resolveObjectKey(config, '../../etc/passwd'), null);
  assert.equal(resolveObjectKey(config, 'key-con-mayúsculas-ABCDE'), null);
  assert.equal(resolveObjectKey(config, 'a'.repeat(31)), null);
  assert.equal(resolveObjectKey(config, 'a'.repeat(33)), null);
  assert.equal(resolveObjectKey(config, 'a'.repeat(32)), 'prod/' + 'a'.repeat(32));
  assert.equal(resolveObjectKey({ prefix: '' }, 'a'.repeat(32)), 'a'.repeat(32));
});

test('S3ScreenshotReader.read devuelve Buffer para 200', async () => {
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const client = makeClient(() => Promise.resolve({ Body: asBody(payload) }));
  const config = { bucket: 'b', prefix: 'prod/' };
  const reader = new S3ScreenshotReader(client, config);
  const result = await reader.read('a'.repeat(32));
  assert.ok(Buffer.isBuffer(result));
  assert.deepEqual(result, payload);
  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0].input.Bucket, 'b');
  assert.equal(client.sent[0].input.Key, 'prod/' + 'a'.repeat(32));
});

test('S3ScreenshotReader.read devuelve null para claves inválidas sin tocar S3', async () => {
  const client = makeClient(() => Promise.reject(new Error('no debería llamarse')));
  const reader = new S3ScreenshotReader(client, { bucket: 'b', prefix: '' });
  assert.equal(await reader.read('invalida'), null);
  assert.equal(client.sent.length, 0);
});

test('S3ScreenshotReader.read devuelve null para NoSuchKey', async () => {
  const notFound = new NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'no such key' });
  const client = makeClient(() => Promise.reject(notFound));
  const reader = new S3ScreenshotReader(client, { bucket: 'b', prefix: '' });
  assert.equal(await reader.read('a'.repeat(32)), null);
});

test('S3ScreenshotReader.read devuelve null para 404 genérico', async () => {
  const notFound = new S3ServiceException({
    name: 'NotFound', message: 'not found', $fault: 'client',
    $metadata: { httpStatusCode: 404 },
  });
  const client = makeClient(() => Promise.reject(notFound));
  const reader = new S3ScreenshotReader(client, { bucket: 'b', prefix: '' });
  assert.equal(await reader.read('a'.repeat(32)), null);
});

test('S3ScreenshotReader.read propaga otros errores', async () => {
  const boom = new Error('kaboom');
  const client = makeClient(() => Promise.reject(boom));
  const reader = new S3ScreenshotReader(client, { bucket: 'b', prefix: '' });
  await assert.rejects(() => reader.read('a'.repeat(32)), /kaboom/);
});

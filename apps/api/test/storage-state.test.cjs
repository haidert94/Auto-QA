const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseStorageState, summarizeStorageState, MAX_STORAGE_STATE_BYTES } = require('../dist/projects/storage-state');

const validState = {
  cookies: [
    { name: 'session', value: 'abc123', domain: 'app.test', path: '/' },
    { name: 'csrf', value: 'xyz', domain: 'app.test', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ],
  origins: [
    { origin: 'https://app.test', localStorage: [{ name: 'token', value: 'jwt.payload.sig' }] },
  ],
};

test('acepta un storageState Playwright válido', () => {
  const parsed = parseStorageState(validState);
  assert.equal(parsed.cookies.length, 2);
  assert.equal(parsed.origins[0].localStorage[0].name, 'token');
});

test('rechaza no-objetos y arrays', () => {
  assert.throws(() => parseStorageState(null), /storage-state-no-es-objeto/);
  assert.throws(() => parseStorageState([]), /storage-state-no-es-objeto/);
  assert.throws(() => parseStorageState('login'), /storage-state-no-es-objeto/);
});

test('rechaza cookies o origins ausentes o no-array', () => {
  assert.throws(() => parseStorageState({ cookies: 'nope', origins: [] }), /cookies-no-es-array/);
  assert.throws(() => parseStorageState({ cookies: [], origins: 'nope' }), /origins-no-es-array/);
});

test('rechaza cookies con campos obligatorios ausentes o tipos mal', () => {
  assert.throws(() => parseStorageState({
    cookies: [{ name: '', value: 'x', domain: 'a.test', path: '/' }], origins: [],
  }), /cookies\[0\]\.name-invalido/);
  assert.throws(() => parseStorageState({
    cookies: [{ name: 'a', value: 'x', domain: 'a.test', path: '/', sameSite: 'Loose' }], origins: [],
  }), /sameSite-invalido/);
});

test('rechaza origins cuyo origin no es URL', () => {
  assert.throws(() => parseStorageState({
    cookies: [], origins: [{ origin: 'no-es-url', localStorage: [] }],
  }), /origin-no-es-url/);
});

test('rechaza blobs por encima del tamaño máximo', () => {
  const huge = { cookies: [], origins: [{
    origin: 'https://a.test',
    localStorage: [{ name: 'k', value: 'x'.repeat(8000) }],
  }] };
  // Un solo valor cabe; pero si hay cientos la suma supera el límite.
  // Forzamos el límite haciendo el JSON crudo gigante.
  const forced = { ...huge, extra: 'y'.repeat(MAX_STORAGE_STATE_BYTES + 100) };
  assert.throws(() => parseStorageState(forced), /storage-state-demasiado-grande/);
});

test('rechaza listas desproporcionadas', () => {
  const tooManyCookies = {
    cookies: Array.from({ length: 501 }, (_, i) => ({ name: 'c' + i, value: 'v', domain: 'a.test', path: '/' })),
    origins: [],
  };
  assert.throws(() => parseStorageState(tooManyCookies), /cookies-demasiados/);
});

test('summarize nunca expone cookies ni localStorage, solo conteos', () => {
  const parsed = parseStorageState(validState);
  const now = new Date();
  const later = new Date(Date.now() + 86400000);
  const summary = summarizeStorageState(parsed, { label: 'QA admin', uploadedAt: now, expiresAt: later });
  assert.deepEqual(Object.keys(summary).sort(), ['cookiesCount', 'expiresAt', 'label', 'originsCount', 'uploadedAt']);
  assert.equal(summary.cookiesCount, 2);
  assert.equal(summary.originsCount, 1);
  assert.equal(summary.label, 'QA admin');
  assert.equal(summary.expiresAt, later.toISOString());
});

test('normaliza eliminando claves inesperadas de las cookies', () => {
  const parsed = parseStorageState({
    cookies: [{ name: 's', value: 'v', domain: 'a.test', path: '/', extra: 'ignored', __proto__: 'danger' }],
    origins: [],
  });
  assert.equal('extra' in parsed.cookies[0], false);
  assert.equal(Object.keys(parsed.cookies[0]).sort().join(','), 'domain,name,path,value');
});

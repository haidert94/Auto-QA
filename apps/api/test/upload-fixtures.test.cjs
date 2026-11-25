// Propiedades de seguridad del verbo upload. Si alguna de estas falla, un
// test generado podría subir un archivo arbitrario del host (/etc/passwd,
// el .env del worker, un socket): por eso el agente nunca ve un path y
// cualquier data fuera de la whitelist se reporta como TODO, sin emitir
// código ejecutable.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  parseUploadFixtureData,
  isUploadFixtureKind,
  uploadFixtureSpec,
  generateUploadFixtureHelper,
  UPLOAD_FIXTURE_KINDS,
} = require('../dist/scenarios/upload-fixtures');
const { generateStepLines, generateSpec, generateHarnessedSpec } = require('../dist/scenarios/playwright-generator');

test('whitelist: solo png, jpg, pdf, txt, csv, json', () => {
  assert.deepEqual([...UPLOAD_FIXTURE_KINDS].sort(), ['csv', 'jpg', 'json', 'pdf', 'png', 'txt']);
});

test('parseUploadFixtureData acepta solo "fixture:<kind>" con kind en whitelist', () => {
  assert.equal(parseUploadFixtureData('fixture:png'), 'png');
  assert.equal(parseUploadFixtureData('fixture:pdf'), 'pdf');
  assert.equal(parseUploadFixtureData('fixture:exe'), null);
  assert.equal(parseUploadFixtureData('fixture:PNG'), null, 'case-sensitive');
  assert.equal(parseUploadFixtureData(''), null);
  assert.equal(parseUploadFixtureData(null), null);
  assert.equal(parseUploadFixtureData(undefined), null);
});

test('seguridad: rutas absolutas y relativas son rechazadas como data', () => {
  for (const malicious of [
    '/etc/passwd',
    'C:\\Windows\\System32\\config\\SAM',
    '../../../etc/shadow',
    'fixture:../../etc/passwd',
    'fixture:pdf;rm -rf /',
    'fixture:pdf /etc/passwd',
    'fixture:pdf\n/etc/passwd',
    'file:///etc/passwd',
    'http://evil.test/payload',
  ]) {
    assert.equal(parseUploadFixtureData(malicious), null, 'debía rechazar: ' + malicious);
  }
});

test('generateStepLines con upload válido emite setInputFiles(autoqaFixture)', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'upload: #file', data: 'fixture:pdf' }, '  ').join('\n');
  assert.match(lines, /await page\.locator\('#file'\)\.setInputFiles\(autoqaFixture\('pdf'\)\);/);
  assert.equal(lines.includes('/etc/'), false);
  assert.equal(lines.includes('C:\\\\'), false);
});

test('generateStepLines con upload inválido emite TODO y NUNCA setInputFiles', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'upload: #file', data: '/etc/passwd' }, '  ').join('\n');
  assert.equal(lines.includes('setInputFiles'), false, 'no se emite setInputFiles');
  assert.equal(lines.includes('/etc/passwd'), false, 'no se interpola el path malicioso');
  assert.match(lines, /TODO: upload requiere data "fixture:<kind>"/);
});

test('generateSpec emite el helper autoqaFixture cuando hay al menos un upload', () => {
  const spec = generateSpec({
    id: 'x', title: 'Subir CV', steps: [
      { ordinal: 1, action: 'navigate: /perfil' },
      { ordinal: 2, action: 'upload: #cv', data: 'fixture:pdf' },
    ],
  });
  assert.match(spec, /function autoqaFixture\(kind\)/);
  assert.match(spec, /case 'pdf': return \{ name: 'autoqa-sample\.pdf', mimeType: 'application\/pdf', buffer: Buffer\.from\('[A-Za-z0-9+\/=]+', 'base64'\) \};/);
  // El helper solo incluye los tipos usados (no pdf+png+jpg+… si solo se usó pdf).
  assert.equal(spec.includes("case 'png':"), false);
});

test('generateSpec no emite helper cuando no hay uploads', () => {
  const spec = generateSpec({
    id: 'x', title: 'Simple', steps: [{ ordinal: 1, action: 'navigate: /' }],
  });
  assert.equal(spec.includes('autoqaFixture'), false);
});

test('generateSpec deduplica fixtures cuando varios pasos usan el mismo tipo', () => {
  const spec = generateSpec({
    id: 'x', title: 'Dos uploads', steps: [
      { ordinal: 1, action: 'upload: #a', data: 'fixture:png' },
      { ordinal: 2, action: 'upload: #b', data: 'fixture:png' },
    ],
  });
  assert.equal(spec.match(/case 'png':/g).length, 1, 'un solo case png');
});

test('generateHarnessedSpec también emite el helper', () => {
  const env = { baseUrl: 'https://app.test', allowedHosts: ['app.test'], allowedPaths: [], excludedPaths: [] };
  const spec = generateHarnessedSpec(
    { id: 'x', title: 'Upload', expectedResult: null, steps: [
      { ordinal: 1, action: 'upload: #file', data: 'fixture:csv' },
    ] },
    env,
  );
  assert.match(spec, /function autoqaFixture\(kind\)/);
  assert.match(spec, /setInputFiles\(autoqaFixture\('csv'\)\)/);
});

test('uploadFixtureSpec devuelve un base64 no vacío y MIME coherente para cada kind', () => {
  for (const kind of UPLOAD_FIXTURE_KINDS) {
    const spec = uploadFixtureSpec(kind);
    assert.ok(spec.base64.length > 0, kind + ' tiene bytes');
    assert.ok(spec.mimeType.includes('/'), kind + ' tiene MIME con slash');
    // Decodifica y verifica que el buffer no es vacío.
    const buffer = Buffer.from(spec.base64, 'base64');
    assert.ok(buffer.length > 0, kind + ' decodifica a bytes');
  }
});

test('png decodifica a un PNG real (firma mágica)', () => {
  const buffer = Buffer.from(uploadFixtureSpec('png').base64, 'base64');
  assert.equal(buffer[0], 0x89, 'firma PNG byte 0');
  assert.equal(buffer[1], 0x50, 'P');
  assert.equal(buffer[2], 0x4e, 'N');
  assert.equal(buffer[3], 0x47, 'G');
});

test('pdf decodifica con el header %PDF-', () => {
  const buffer = Buffer.from(uploadFixtureSpec('pdf').base64, 'base64');
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('generateUploadFixtureHelper con conjunto vacío no emite nada', () => {
  assert.equal(generateUploadFixtureHelper(new Set()), '');
});

test('isUploadFixtureKind descarta strings arbitrarios', () => {
  assert.equal(isUploadFixtureKind('png'), true);
  assert.equal(isUploadFixtureKind('exe'), false);
  assert.equal(isUploadFixtureKind(''), false);
  assert.equal(isUploadFixtureKind('../../../etc/passwd'), false);
});

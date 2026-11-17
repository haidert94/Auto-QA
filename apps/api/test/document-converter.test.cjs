// Pruebas puras del converter. Sin BD, sin IA.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { convertDocument, needsAiFallback } = require('../dist/automation/document-converter');

test('convertDocument: markdown pasa tal cual', async () => {
  const result = await convertDocument({
    filename: 'historia.md',
    bytes: Buffer.from('# Historia\n\nComo usuario quiero iniciar sesión.\n'),
  });
  assert.equal(result.mime, 'text/markdown');
  assert.ok(result.markdown.includes('Historia'));
  assert.equal(result.warnings.length, 0);
});

test('convertDocument: texto plano se preserva', async () => {
  const result = await convertDocument({
    filename: 'notas.txt',
    bytes: Buffer.from('Primera nota\nSegunda nota'),
  });
  assert.equal(result.mime, 'text/plain');
  assert.ok(result.markdown.includes('Primera nota'));
});

test('convertDocument: formato desconocido devuelve warning', async () => {
  const result = await convertDocument({
    filename: 'raro.zip',
    bytes: Buffer.from([0x50, 0x4B, 0x03, 0x04]),
  });
  assert.ok(result.warnings.some(w => w.startsWith('formato-no-soportado')));
});

test('convertDocument: sanitiza caracteres de control', async () => {
  const result = await convertDocument({
    filename: 'raro.md',
    bytes: Buffer.from('Hola\u0000mundo\u0007texto'),
  });
  assert.ok(!result.markdown.includes('\u0000'));
  assert.ok(!result.markdown.includes('\u0007'));
  assert.ok(result.markdown.includes('Hola'));
  assert.ok(result.markdown.includes('mundo'));
});

test('convertDocument: trunca texto muy largo', async () => {
  const bigText = 'a'.repeat(100000);
  const result = await convertDocument({
    filename: 'grande.txt',
    bytes: Buffer.from(bigText),
  });
  assert.ok(result.markdown.length <= 60100);
  assert.ok(result.warnings.includes('truncado-a-60k-chars'));
});

test('needsAiFallback: texto muy corto sugiere fallback', () => {
  assert.equal(needsAiFallback({
    filename: 'x.pdf', mime: 'application/pdf', markdown: '', sourceBytes: 100, warnings: [],
  }), true);
  assert.equal(needsAiFallback({
    filename: 'x.md', mime: 'text/markdown',
    markdown: 'Documento con suficiente texto para ser considerado válido por el analizador IA en el pipeline.',
    sourceBytes: 100, warnings: [],
  }), false);
});

test('needsAiFallback: warning específico fuerza fallback', () => {
  assert.equal(needsAiFallback({
    filename: 'x.pdf', mime: 'application/pdf',
    markdown: 'Texto larguísimo que supera los 80 caracteres y por sí solo no activaría fallback IA.',
    sourceBytes: 100, warnings: ['pdf-sin-texto-extraible'],
  }), true);
});

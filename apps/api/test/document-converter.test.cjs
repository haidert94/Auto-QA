// Pruebas puras del converter. Sin BD, sin IA.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { convertDocument, needsAiFallback, sourceBlocksToMarkdown } = require('../dist/automation/document-converter');
const { suggestDocumentTestTypes } = require('../dist/documents/document-test-type-review');

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

test('revisa el Markdown convertido y sugiere solo tipos con indicios en el contenido', () => {
  const markdown = sourceBlocksToMarkdown([
    { locator: 'página 1, línea 1', text: '# Especificación' },
    { locator: 'página 1, línea 2', text: 'HU-1: iniciar sesión en el catálogo.' },
    { locator: 'página 2, línea 1', text: 'La vista móvil requiere diseño adaptativo.' },
    { locator: 'página 2, línea 2', text: 'Chrome, Firefox y Safari deben mostrar la misma página.' },
    { locator: 'página 2, línea 3', text: 'Monitoreo HTTP y SLA de disponibilidad del servicio.' },
    { locator: 'página 2, línea 4', text: 'Medir latencia p95 y cumplimiento de WCAG.' },
    { locator: 'página 2, línea 5', text: 'La verificación manual requiere criterio humano.' },
  ]);
  assert.match(markdown, /^# Especificación\n\nHU-1/);
  assert.deepEqual(suggestDocumentTestTypes(markdown), ['functional_web', 'mobile_emulated', 'compatibility', 'availability', 'performance', 'ux', 'manual']);
  assert.deepEqual(suggestDocumentTestTypes('Manual de usuario. Datos de contacto y fechas.'), []);
  assert.deepEqual(suggestDocumentTestTypes('La experiencia de usuario requiere navegación por teclado.'), ['ux']);
});

test('sugiere disponibilidad por la categoría de una historia y distingue el inventario', () => {
  const markdown = [
    'Historia | Categoría | Prioridad | Criterio de aceptación',
    'HU-D02 | Disponibilidad | Alta | Registra el resultado de cada intento.',
  ].join('\n');
  assert.ok(suggestDocumentTestTypes(markdown).includes('availability'));
  assert.ok(suggestDocumentTestTypes('| HU-D03 | Disponibilidad | Alta | Registrar cada comprobación. |').includes('availability'));
  assert.ok(suggestDocumentTestTypes('Disponibilidad de la página de inicio.').includes('availability'));
  assert.ok(!suggestDocumentTestTypes('SKU-05 | Disponibilidad | Inventario').includes('availability'));
  assert.ok(!suggestDocumentTestTypes('HU-01 | Funcional | Consultar la disponibilidad de productos.').includes('availability'));
});

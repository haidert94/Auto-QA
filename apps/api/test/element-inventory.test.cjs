const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  formatElementLine,
  buildElementInventoryContext,
} = require('../dist/automation/element-inventory');

test('testid wins over text, name and id', () => {
  const line = formatElementLine({
    tag: 'button', testid: 'submit-btn', testidAttr: 'data-testid',
    text: 'Enviar', id: 'submit', name: 'submit',
  });
  assert.equal(line, 'click: [data-testid="submit-btn"]');
});

test('visible text beats id for clickable element without testid', () => {
  const line = formatElementLine({ tag: 'button', text: 'Guardar cambios', id: 'save' });
  assert.equal(line, 'click-text: Guardar cambios');
});

test('link emits click-text with href hint', () => {
  const line = formatElementLine({ tag: 'a', text: 'Ver detalle', href: '/detalle/42' });
  assert.equal(line, 'click-text: Ver detalle (enlace a /detalle/42)');
});

test('label wins over id for input without testid', () => {
  const line = formatElementLine({ tag: 'input', type: 'email', label: 'Correo', id: 'email' });
  assert.equal(line, 'fill-label: Correo (type=email)');
});

test('name beats id when both present and no label', () => {
  const line = formatElementLine({ tag: 'input', name: 'username', id: 'user-1234' });
  assert.equal(line, 'fill: [name="username"]');
});

test('plain id is used when only id is available', () => {
  const line = formatElementLine({ tag: 'input', id: 'phone' });
  assert.equal(line, 'fill: #phone');
});

test('auto-generated ids (radix, hash, react useId, numeric suffix) are rejected', () => {
  for (const id of ['radix-xyz-1', 'a1b2c3d4e5f6', ':r2:', 'component-1234']) {
    const line = formatElementLine({ tag: 'button', id });
    assert.equal(line, null, 'id ' + id + ' should be rejected');
  }
});

test('escapes quotes inside testid and name values', () => {
  const line = formatElementLine({
    tag: 'input', name: 'with"quote', testidAttr: undefined,
  });
  assert.equal(line, 'fill: [name="with\\"quote"]');
});

test('data-cy is recognized as a testid attribute', () => {
  const line = formatElementLine({
    tag: 'button', testid: 'login', testidAttr: 'data-cy', text: 'Login',
  });
  assert.equal(line, 'click: [data-cy="login"]');
});

test('element with no usable hints returns null', () => {
  assert.equal(formatElementLine({ tag: 'div' }), null);
  assert.equal(formatElementLine({ tag: 'button' }), null);
});

test('buildElementInventoryContext dedupes repeated lines across pages', () => {
  const pages = [
    { url: 'https://app.test/a', elements: [{ tag: 'button', text: 'Guardar' }, { tag: 'a', text: 'Inicio' }] },
    { url: 'https://app.test/b', elements: [{ tag: 'a', text: 'Inicio' }, { tag: 'button', text: 'Cancelar' }] },
  ];
  const out = buildElementInventoryContext(pages);
  const lines = out.split('\n');
  assert.deepEqual(lines, [
    '# /a',
    'click-text: Guardar',
    'click-text: Inicio',
    '# /b',
    'click-text: Cancelar',
  ]);
});

test('buildElementInventoryContext respects the global line limit', () => {
  const elements = Array.from({ length: 10 }, (_, i) => ({ tag: 'button', text: 'Boton ' + i }));
  const out = buildElementInventoryContext([{ url: 'https://app.test/', elements }], 3);
  const lines = out.split('\n').filter(l => !l.startsWith('#'));
  assert.equal(lines.length, 3);
});

test('buildElementInventoryContext skips pages whose elements are all unusable', () => {
  const pages = [
    { url: 'https://app.test/skip', elements: [{ tag: 'div' }, { tag: 'button', id: 'radix-abc' }] },
    { url: 'https://app.test/keep', elements: [{ tag: 'button', text: 'OK' }] },
  ];
  const out = buildElementInventoryContext(pages);
  assert.equal(out, '# /keep\nclick-text: OK');
});

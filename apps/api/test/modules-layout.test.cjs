const assert = require('node:assert/strict');
const { test } = require('node:test');

const { sanitizeModulesLayout } = require('../dist/projects/onboarding');

test('acepta coordenadas válidas de módulos listados', () => {
  const out = sanitizeModulesLayout(
    { Checkout: { x: 0.2, y: 0.5 }, Login: { x: 0, y: 1 } },
    ['Checkout', 'Login'],
  );
  assert.deepEqual(out, { Checkout: { x: 0.2, y: 0.5 }, Login: { x: 0, y: 1 } });
});

test('descarta módulos que no están en priorityModules', () => {
  const out = sanitizeModulesLayout(
    { Checkout: { x: 0.2, y: 0.5 }, Fantasma: { x: 0.1, y: 0.1 } },
    ['Checkout'],
  );
  assert.deepEqual(out, { Checkout: { x: 0.2, y: 0.5 } });
});

test('rechaza coordenadas fuera de [0..1], no numéricas o infinitas', () => {
  const out = sanitizeModulesLayout(
    {
      A: { x: 1.5, y: 0.5 },
      B: { x: -0.1, y: 0 },
      C: { x: 'cero', y: 0 },
      D: { x: Infinity, y: 0 },
      E: { x: NaN, y: 0.5 },
      OK: { x: 0.5, y: 0.5 },
    },
    ['A', 'B', 'C', 'D', 'E', 'OK'],
  );
  assert.deepEqual(out, { OK: { x: 0.5, y: 0.5 } });
});

test('devuelve undefined cuando nada queda válido', () => {
  const out = sanitizeModulesLayout({ A: { x: 2, y: 2 } }, ['A']);
  assert.equal(out, undefined);
});

test('devuelve undefined para entradas no-objeto', () => {
  assert.equal(sanitizeModulesLayout(null, []), undefined);
  assert.equal(sanitizeModulesLayout([], []), undefined);
  assert.equal(sanitizeModulesLayout('texto', []), undefined);
});

test('descarta valores con shape incorrecto', () => {
  const out = sanitizeModulesLayout(
    { A: null, B: 'nope', C: { x: 0.1 }, D: { x: 0.1, y: 0.1 } },
    ['A', 'B', 'C', 'D'],
  );
  assert.deepEqual(out, { D: { x: 0.1, y: 0.1 } });
});

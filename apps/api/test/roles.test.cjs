// Pruebas puras del helper de roles. Sin BD.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { hasRole } = require('../dist/commerce/workspace.guard');

test('OWNER cumple cualquier requisito', () => {
  assert.equal(hasRole('OWNER', ['OWNER']), true);
  assert.equal(hasRole('OWNER', ['ADMIN']), true);
  assert.equal(hasRole('OWNER', ['EDITOR']), true);
  assert.equal(hasRole('OWNER', ['VIEWER']), true);
});

test('ADMIN cumple ADMIN hacia abajo pero no OWNER', () => {
  assert.equal(hasRole('ADMIN', ['ADMIN']), true);
  assert.equal(hasRole('ADMIN', ['EDITOR']), true);
  assert.equal(hasRole('ADMIN', ['VIEWER']), true);
  assert.equal(hasRole('ADMIN', ['OWNER']), false);
});

test('EDITOR cumple EDITOR y VIEWER', () => {
  assert.equal(hasRole('EDITOR', ['EDITOR']), true);
  assert.equal(hasRole('EDITOR', ['VIEWER']), true);
  assert.equal(hasRole('EDITOR', ['ADMIN']), false);
  assert.equal(hasRole('EDITOR', ['OWNER']), false);
});

test('VIEWER solo cumple VIEWER', () => {
  assert.equal(hasRole('VIEWER', ['VIEWER']), true);
  assert.equal(hasRole('VIEWER', ['EDITOR']), false);
  assert.equal(hasRole('VIEWER', ['ADMIN']), false);
  assert.equal(hasRole('VIEWER', ['OWNER']), false);
});

test('Con varios roles requeridos, pasa si cumple el más bajo', () => {
  // Pedir ['ADMIN', 'VIEWER'] significa "al menos VIEWER" (mínimo del rango).
  assert.equal(hasRole('VIEWER', ['ADMIN', 'VIEWER']), true);
  assert.equal(hasRole('EDITOR', ['ADMIN', 'VIEWER']), true);
});

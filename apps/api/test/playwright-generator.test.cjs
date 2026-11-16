// Pruebas puras del generador: no tocan BD, no requieren AUTOQA_TEST_DATABASE_URL.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { escapeJsString, generateSpec, generateStepLines, suggestedFilename } = require('../dist/scenarios/playwright-generator');

test('escapeJsString escapa comillas, backslashes y newlines', () => {
  assert.equal(escapeJsString("O'Reilly"), "O\\'Reilly");
  assert.equal(escapeJsString("C:\\path"), "C:\\\\path");
  assert.equal(escapeJsString("line1\nline2"), "line1\\nline2");
  assert.equal(escapeJsString("x\ty"), "x\\ty");
});

test('escapeJsString previene inyección de template literal y separadores Unicode', () => {
  assert.equal(escapeJsString('${danger}'), '${danger}');
  // El $ pelado no necesita escape dentro de comillas simples,
  // pero los separadores Unicode sí (U+2028, U+2029).
  assert.equal(escapeJsString('a\u2028b'), 'a\\u2028b');
  assert.equal(escapeJsString('a\u2029b'), 'a\\u2029b');
});

test('generateStepLines navigate emite page.goto', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'navigate: https://example.com/login' }, '  ');
  assert.ok(lines.some(l => l.includes("await page.goto('https://example.com/login');")));
});

test('generateStepLines click emite page.locator().click', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'click: button.primary' }, '  ');
  assert.ok(lines.some(l => l.includes("await page.locator('button.primary').click();")));
});

test('generateStepLines fill usa el campo data', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'fill: #email', data: 'user@test.com' }, '  ');
  assert.ok(lines.some(l => l.includes("await page.locator('#email').fill('user@test.com');")));
});

test('generateStepLines expect-text emite expect().toBeVisible', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'expect-text: Bienvenido' }, '  ');
  assert.ok(lines.some(l => l.includes("await expect(page.getByText('Bienvenido')).toBeVisible();")));
});

test('generateStepLines expect-url emite toHaveURL', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'expect-url: /dashboard' }, '  ');
  assert.ok(lines.some(l => l.includes("await expect(page).toHaveURL('/dashboard');")));
});

test('generateStepLines sin prefijo reconocido emite TODO', () => {
  const lines = generateStepLines({ ordinal: 2, action: 'Haz magia' }, '  ');
  assert.ok(lines.some(l => l.includes('// TODO: Haz magia')));
});

test('generateStepLines con verbo desconocido lo señala', () => {
  const lines = generateStepLines({ ordinal: 2, action: 'hover: a.menu' }, '  ');
  assert.ok(lines.some(l => l.includes('verbo "hover" no reconocido')));
});

test('generateStepLines incluye el comentario Esperado cuando existe', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'click: .ok', expected: 'El modal se cierra' }, '  ');
  assert.ok(lines.some(l => l.includes('// Esperado: El modal se cierra')));
});

test('generateSpec produce un spec completo con import, test y pasos', () => {
  const spec = generateSpec({
    id: 'abcd1234-ab12-cd34-ef56-7890abcdef12',
    title: 'Login válido',
    expectedResult: 'Usuario entra al dashboard',
    steps: [
      { ordinal: 1, action: 'navigate: https://app/login' },
      { ordinal: 2, action: 'fill: #email', data: 'user@test.com' },
      { ordinal: 3, action: 'click: button[type=submit]' },
      { ordinal: 4, action: 'expect-url: /dashboard' },
    ],
  });
  assert.ok(spec.includes("import { expect, test } from '@playwright/test';"));
  assert.ok(spec.includes("test('Login válido', async ({ page }) => {"));
  assert.ok(spec.includes("await page.goto('https://app/login');"));
  assert.ok(spec.includes("await page.locator('#email').fill('user@test.com');"));
  assert.ok(spec.includes("await page.locator('button[type=submit]').click();"));
  assert.ok(spec.includes("await expect(page).toHaveURL('/dashboard');"));
  assert.ok(spec.includes('// Resultado esperado: Usuario entra al dashboard'));
  assert.ok(spec.includes('// Validacion final sugerida'));
});

test('generateSpec escapa el título contra comillas', () => {
  const spec = generateSpec({
    id: '00000000-0000-0000-0000-000000000000',
    title: "O'Reilly checkout",
    steps: [],
  });
  assert.ok(spec.includes("test('O\\'Reilly checkout'"));
});

test('generateSpec sin pasos emite marcador TODO', () => {
  const spec = generateSpec({ id: 'x', title: 'Vacío', steps: [] });
  assert.ok(spec.includes('// TODO: define los pasos del escenario en AutoQA.'));
});

test('suggestedFilename produce slug seguro', () => {
  assert.equal(suggestedFilename({ id: 'x', title: 'Login válido' }), 'login-valido.spec.ts');
  assert.equal(suggestedFilename({ id: 'x', title: '  Foo!! Bar??  ' }), 'foo-bar.spec.ts');
  assert.equal(suggestedFilename({ id: 'abcd1234', title: '!!!' }), 'abcd1234.spec.ts');
});

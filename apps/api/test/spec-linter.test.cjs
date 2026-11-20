// Linter determinista del spec generado (capa 3a del pipeline).
// Reglas deterministas, sin BD ni red.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { lintPreparedSteps, lintGeneratedCode, hasBlockingIssue, summarizeIssues } = require('../dist/scenarios/spec-linter');

test('lintPreparedSteps marca error si no hay pasos', () => {
  const issues = lintPreparedSteps([]);
  assert.ok(issues.some(i => i.code === 'empty' && i.severity === 'error'));
});

test('lintPreparedSteps exige al menos una aserción', () => {
  const issues = lintPreparedSteps([
    { ordinal: 1, action: 'navigate: /login' },
    { ordinal: 2, action: 'click-text: Entrar' },
  ]);
  assert.ok(issues.some(i => i.code === 'no-assertion' && i.severity === 'error'));
});

test('lintPreparedSteps detecta URL absoluta en navigate', () => {
  const issues = lintPreparedSteps([
    { ordinal: 1, action: 'navigate: https://malicioso.com/pwn' },
    { ordinal: 2, action: 'expect-visible: .ok' },
  ]);
  assert.ok(issues.some(i => i.code === 'absolute-url' && i.severity === 'error'));
});

test('lintPreparedSteps acepta un flujo correcto', () => {
  const issues = lintPreparedSteps([
    { ordinal: 1, action: 'navigate: /login' },
    { ordinal: 2, action: 'fill-label: Usuario', data: 'tester' },
    { ordinal: 3, action: 'expect-text: Bienvenido' },
  ]);
  assert.ok(!issues.some(i => i.severity === 'error'));
});

test('lintGeneratedCode exige expect(', () => {
  const issues = lintGeneratedCode("import { test } from '@playwright/test';\ntest('x', async () => {});");
  assert.ok(issues.some(i => i.code === 'no-expect' && i.severity === 'error'));
});

test('lintGeneratedCode detecta credenciales literales', () => {
  const code = "await page.fill('#pwd', 'password=Secr3t!');\nexpect(true).toBe(true);";
  const issues = lintGeneratedCode(code);
  assert.ok(issues.some(i => i.code === 'hardcoded-secret' && i.severity === 'error'));
});

test('lintGeneratedCode detecta navegación externa absoluta', () => {
  const issues = lintGeneratedCode("await page.goto('https://externo.com');\nexpect(true).toBe(true);");
  assert.ok(issues.some(i => i.code === 'external-navigation' && i.severity === 'error'));
});

test('lintGeneratedCode warn por waitForTimeout', () => {
  const issues = lintGeneratedCode("expect(true).toBe(true);\nawait page.waitForTimeout(1000);");
  const warn = issues.find(i => i.code === 'wait-for-timeout');
  assert.ok(warn && warn.severity === 'warn');
  assert.ok(!hasBlockingIssue(issues));
});

test('summarizeIssues concatena con separadores legibles', () => {
  const summary = summarizeIssues([
    { code: 'x', severity: 'error', message: 'Falla A' },
    { code: 'y', severity: 'warn', message: 'Aviso B' },
  ]);
  assert.match(summary, /Falla A/);
  assert.match(summary, /Aviso B/);
});

// Propiedades del verbo multi-tab. La semántica canónica de Playwright
// requiere Promise.all([context.waitForEvent('page'), click]); si el spec
// no la emite, los popups se pierden. El nombre de tab se interpola literal
// en strings y en identificadores: validar el whitelist es seguridad, no
// estilo.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  generateStepLines, generateSpec, generateHarnessedSpec, readGeneratorSteps,
  TAB_NAME_PATTERN,
} = require('../dist/scenarios/playwright-generator');

test('TAB_NAME_PATTERN acepta nombres cortos en minúscula con guión y _', () => {
  for (const good of ['aux', 'pdf', 'tab-1', 'auth_popup', 'a', 'abcdefghij0123456789abcdefghij0']) {
    assert.ok(TAB_NAME_PATTERN.test(good), 'debía aceptar: ' + good);
  }
});

test('TAB_NAME_PATTERN rechaza mayúsculas, inicial no-letra y caracteres sospechosos', () => {
  for (const bad of ['PDF', 'Aux', '1tab', '-x', 'x y', "x'", 'x; evil()', 'abcdefghij0123456789abcdefghij01', '']) {
    assert.equal(TAB_NAME_PATTERN.test(bad), false, 'debía rechazar: ' + bad);
  }
});

test('open-tab emite el patrón canónico Promise.all([waitForEvent, click])', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'open-tab: a.pdf-link', data: 'pdf' }, '  ').join('\n');
  assert.match(lines, /const \[newTab\] = await Promise\.all\(\[/);
  assert.match(lines, /page\.context\(\)\.waitForEvent\('page'\)/);
  assert.match(lines, /page\.locator\('a\.pdf-link'\)\.click\(\)/);
  assert.match(lines, /await newTab\.waitForLoadState\(\)/);
  assert.match(lines, /tabs\.set\('pdf', newTab\)/);
});

test('open-tab con nombre inválido emite TODO, sin interpolar el valor', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'open-tab: a', data: "'; evil('" }, '  ').join('\n');
  assert.equal(lines.includes('waitForEvent'), false);
  assert.equal(lines.includes("'; evil('"), false);
  assert.match(lines, /TODO: open-tab requiere data con un nombre lógico/);
});

test('close-tab emite tabs.get().close() + tabs.delete()', () => {
  const lines = generateStepLines({ ordinal: 1, action: 'close-tab: pdf' }, '  ').join('\n');
  assert.match(lines, /const tab = tabs\.get\('pdf'\);/);
  assert.match(lines, /if \(tab\) \{ await tab\.close\(\); tabs\.delete\('pdf'\); \}/);
});

test('close-tab con nombre inválido no emite tabs.get', () => {
  const lines = generateStepLines({ ordinal: 1, action: "close-tab: '; drop(" }, '  ').join('\n');
  assert.equal(lines.includes('tabs.get'), false);
  assert.match(lines, /TODO: close-tab requiere un nombre lógico/);
});

test('tabScope redirige TODO los verbos del paso a tabs.get(name)', () => {
  // click normal
  let lines = generateStepLines({ ordinal: 1, action: 'click: #ok', tabScope: 'pdf' }, '  ').join('\n');
  assert.match(lines, /await tabs\.get\('pdf'\)\.locator\('#ok'\)\.click\(\);/);
  // navigate
  lines = generateStepLines({ ordinal: 1, action: 'navigate: /inicio', tabScope: 'pdf' }, '  ').join('\n');
  assert.match(lines, /await tabs\.get\('pdf'\)\.goto\('\/inicio'\);/);
  // expect-url
  lines = generateStepLines({ ordinal: 1, action: 'expect-url: /inicio', tabScope: 'pdf' }, '  ').join('\n');
  assert.match(lines, /await expect\(tabs\.get\('pdf'\)\)\.toHaveURL\('\/inicio'\);/);
  // press
  lines = generateStepLines({ ordinal: 1, action: 'press: Escape', tabScope: 'pdf' }, '  ').join('\n');
  assert.match(lines, /await tabs\.get\('pdf'\)\.keyboard\.press\('Escape'\);/);
  // screenshot (parte del rendering automático de generateStepLines)
  assert.match(lines, /await tabs\.get\('pdf'\)\.screenshot/);
});

test('readGeneratorSteps descarta tabScope inválido', () => {
  const [a, b, c] = readGeneratorSteps([
    { action: 'click: #ok', tabScope: 'valid-name' },
    { action: 'click: #ok', tabScope: "'; evil('" },
    { action: 'click: #ok', tabScope: 'UPPER' },
  ]);
  assert.equal(a.tabScope, 'valid-name');
  assert.equal(b.tabScope, undefined);
  assert.equal(c.tabScope, undefined);
});

test('generateSpec declara el Map de tabs cuando hay open-tab', () => {
  const spec = generateSpec({
    id: 'x', title: 'Flujo PDF', steps: [
      { ordinal: 1, action: 'open-tab: a.pdf', data: 'pdf' },
      { ordinal: 2, action: 'expect-text: Aceptar', tabScope: 'pdf' },
      { ordinal: 3, action: 'close-tab: pdf' },
    ],
  });
  // Un solo Map, dentro del test block (indentado 2 espacios).
  assert.equal((spec.match(/const tabs = new Map\(\);/g) || []).length, 1);
});

test('generateSpec NO declara el Map cuando no hay tabs ni tabScope', () => {
  const spec = generateSpec({
    id: 'x', title: 'simple', steps: [{ ordinal: 1, action: 'navigate: /' }],
  });
  assert.equal(spec.includes('const tabs = new Map'), false);
});

test('generateHarnessedSpec también declara el Map cuando el flujo usa tabs', () => {
  const env = { baseUrl: 'https://app.test', allowedHosts: ['app.test'], allowedPaths: [], excludedPaths: [] };
  const spec = generateHarnessedSpec(
    { id: 'x', title: 'X', expectedResult: null, steps: [
      { ordinal: 1, action: 'open-tab: a', data: 'aux' },
      { ordinal: 2, action: 'close-tab: aux' },
    ] },
    env,
  );
  assert.match(spec, /const tabs = new Map\(\);/);
  assert.match(spec, /page\.context\(\)\.waitForEvent\('page'\)/);
});

test('un step con tabScope que a su vez abre otra tab usa el pageExpr correcto', () => {
  // open-tab en tabScope 'parent' debe llamar parent.context(), no page.context().
  const lines = generateStepLines(
    { ordinal: 1, action: 'open-tab: a.child-link', data: 'child', tabScope: 'parent' },
    '  ',
  ).join('\n');
  assert.match(lines, /tabs\.get\('parent'\)\.context\(\)\.waitForEvent\('page'\)/);
  assert.match(lines, /tabs\.get\('parent'\)\.locator\('a\.child-link'\)\.click\(\)/);
  assert.match(lines, /tabs\.set\('child', newTab\)/);
});

test('seguridad: tabScope con payload de inyección queda descartado', () => {
  // El valor del campo tabScope se interpola LITERAL en el spec. Si no se
  // sanitiza con TAB_NAME_PATTERN, un agente comprometido podría romper el
  // string y ejecutar JS arbitrario en el runner. Verificamos que no.
  const [step] = readGeneratorSteps([
    { action: 'click: #x', tabScope: "'; await evil(); //" },
  ]);
  assert.equal(step.tabScope, undefined);
  // Y al generar el paso, no aparece el payload en ningún lado.
  const lines = generateStepLines(step, '  ').join('\n');
  assert.equal(lines.includes('evil()'), false);
  // Se renderiza como un click normal en page, no en tabs.get(...).
  assert.match(lines, /await page\.locator\('#x'\)\.click\(\);/);
});

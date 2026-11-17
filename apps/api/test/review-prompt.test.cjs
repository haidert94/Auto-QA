const assert = require('node:assert/strict');
const { test } = require('node:test');

const { buildReviewPrompt, levelFromScore, parseReviewResponse } = require('../dist/automation/review-prompt');

test('levelFromScore clasifica correctamente los umbrales', () => {
  assert.equal(levelFromScore(95), 'Óptimo');
  assert.equal(levelFromScore(85), 'Óptimo');
  assert.equal(levelFromScore(70), 'Aceptable');
  assert.equal(levelFromScore(50), 'Mejorable');
  assert.equal(levelFromScore(49), 'Insuficiente');
});

test('buildReviewPrompt incluye proyecto y documentos', () => {
  const prompt = buildReviewPrompt({
    projectName: 'App de reservas',
    baseUrl: 'https://app.ejemplo.com',
    description: 'Reservas de mesas',
    documents: [{ filename: 'historias.md', markdown: '# Login\nComo usuario...' }],
  });
  assert.ok(prompt.includes('App de reservas'));
  assert.ok(prompt.includes('https://app.ejemplo.com'));
  assert.ok(prompt.includes('historias.md'));
  assert.ok(prompt.includes('"score": 0-100'));
});

test('parseReviewResponse extrae JSON y aplica límites', () => {
  const text = `Aquí tienes:
  {
    "score": 150,
    "summary": "ok",
    "categories": [{ "code": "req", "label": "Reqs", "percent": 120 }],
    "stories": [{ "title": "Login", "coverage": "completa" }],
    "warnings": [],
    "recommendation": "continuar"
  }`;
  const result = parseReviewResponse(text);
  assert.equal(result.score, 100);
  assert.equal(result.level, 'Óptimo');
  assert.equal(result.categories[0].percent, 100);
  assert.equal(result.stories[0].coverage, 'completa');
});

test('parseReviewResponse fuerza "no-cubierta" si coverage no es válido', () => {
  const text = '{"score": 50, "summary": "", "categories": [], "stories": [{"title": "X", "coverage": "inventada"}], "warnings": [], "recommendation": ""}';
  const result = parseReviewResponse(text);
  assert.equal(result.stories[0].coverage, 'no-cubierta');
});

test('parseReviewResponse devuelve diagnóstico mínimo si no hay JSON', () => {
  const result = parseReviewResponse('texto plano sin json aquí');
  assert.equal(result.score, 0);
  assert.equal(result.level, 'Insuficiente');
  assert.ok(result.warnings.includes('respuesta-no-json'));
});

test('parseReviewResponse recorta listas enormes', () => {
  const stories = Array.from({ length: 200 }, (_, i) => ({ title: 'Historia ' + i, coverage: 'parcial' }));
  const text = JSON.stringify({ score: 70, summary: '', categories: [], stories, warnings: [], recommendation: '' });
  const result = parseReviewResponse(text);
  assert.equal(result.stories.length, 100);
});

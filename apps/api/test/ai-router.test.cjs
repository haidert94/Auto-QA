// Pruebas puras del router IA y del cálculo de costos. No tocan BD ni
// las APIs reales de Anthropic/OpenAI.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { estimateCost, PRICING_COP_PER_MTOK } = require('../dist/ai/ai-provider');
const { RuleBasedProvider } = require('../dist/ai/rule-based-provider');

test('estimateCost: Haiku 1k in / 500 out → ~5 COP', () => {
  const cost = estimateCost('claude-haiku-4-5', 1000, 500);
  // (1000 * 3280 + 500 * 16400) / 1_000_000 = 3.28 + 8.2 = 11.48 → ceil 12
  assert.equal(cost, 12);
});

test('estimateCost: Sonnet 5k in / 2k out → ~185 COP', () => {
  const cost = estimateCost('claude-sonnet-4-5', 5000, 2000);
  // (5000 * 12300 + 2000 * 61500) / 1_000_000 = 61.5 + 123 = 184.5 → 185
  assert.equal(cost, 185);
});

test('estimateCost: rule-based siempre 0', () => {
  assert.equal(estimateCost('rule-based', 10000, 10000), 0);
});

test('PRICING tiene entrada para todos los modelos soportados', () => {
  const required = ['claude-haiku-4-5', 'claude-sonnet-4-5', 'gpt-4o', 'gpt-4o-mini', 'rule-based'];
  for (const m of required) {
    assert.ok(PRICING_COP_PER_MTOK[m], 'falta tarifa para ' + m);
    assert.ok('input' in PRICING_COP_PER_MTOK[m]);
    assert.ok('output' in PRICING_COP_PER_MTOK[m]);
  }
});

test('RuleBasedProvider devuelve fallback con usedFallback=true', async () => {
  const provider = new RuleBasedProvider();
  const response = await provider.complete({ operation: 'scenario-generation', prompt: 'x' });
  assert.equal(response.model, 'rule-based');
  assert.equal(response.usedFallback, true);
  assert.equal(response.inputTokens, 0);
  assert.equal(response.outputTokens, 0);
  assert.equal(response.estimatedCostCop, 0);
  assert.ok(response.text.length > 0);
});

test('RuleBasedProvider cubre todas las operaciones', async () => {
  const provider = new RuleBasedProvider();
  for (const op of ['document-analysis', 'scenario-generation', 'failure-explanation', 'document-classification']) {
    const response = await provider.complete({ operation: op, prompt: '' });
    assert.ok(response.text.length > 0, 'sin texto para ' + op);
  }
});

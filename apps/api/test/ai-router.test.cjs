// Pruebas puras del router IA y del cálculo de costos. No tocan BD ni
// las APIs reales de Anthropic/OpenAI.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { estimateCost, PRICING_COP_PER_MTOK } = require('../dist/ai/ai-provider');
const { RuleBasedProvider } = require('../dist/ai/rule-based-provider');
const { BudgetService } = require('../dist/ai/budget.service');
const { generationResponseErrors } = require('../dist/automation/agents/agent-types');
const { summarizeGeneration } = require('../dist/automation/generation-result');
const { AiRouter, ALTERNATIVE_MODEL, MODEL_BY_OPERATION, modelForOperation } = require('../dist/ai/ai-router');

function withEnv(env, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('estimateCost: Haiku 1k in / 500 out → 12 COP', () => {
  const cost = estimateCost('claude-haiku-5-5', 1000, 500);
  // (1000 * 3280 + 500 * 16400) / 1_000_000 = 3.28 + 8.2 = 11.48 → ceil 12
  assert.equal(cost, 12);
});

test('estimateCost: Sonnet 5k in / 2k out → ~185 COP', () => {
  const cost = estimateCost('claude-sonnet-5-5', 5000, 2000);
  // (5000 * 12300 + 2000 * 61500) / 1_000_000 = 61.5 + 123 = 184.5 → 185
  assert.equal(cost, 185);
});

test('estimateCost: rule-based siempre 0', () => {
  assert.equal(estimateCost('rule-based', 10000, 10000), 0);
});

test('PRICING tiene entrada para todos los modelos soportados', () => {
  const required = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-4o', 'gpt-4o-mini', 'rule-based'];
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

test('MODEL_BY_OPERATION asigna Haiku a tareas simples y Sonnet a complejas', () => {
  assert.equal(MODEL_BY_OPERATION['document-classification'], 'claude-haiku-5-5');
  assert.equal(MODEL_BY_OPERATION['failure-explanation'], 'claude-haiku-5-5');
  assert.equal(MODEL_BY_OPERATION['document-analysis'], 'claude-haiku-5-5');
  assert.equal(MODEL_BY_OPERATION['scenario-generation'], 'claude-sonnet-5-5');
});

test('modelForOperation respeta el override por env var', () => {
  withEnv({ AUTOQA_AI_MODEL_SUGGEST: 'gpt-4o' }, () => {
    assert.equal(modelForOperation('scenario-generation'), 'gpt-4o');
  });
  withEnv({ AUTOQA_AI_MODEL_EXPLAIN: 'gpt-4o-mini' }, () => {
    assert.equal(modelForOperation('failure-explanation'), 'gpt-4o-mini');
  });
});

test('modelForOperation ignora valores inválidos en env', () => {
  withEnv({ AUTOQA_AI_MODEL_SUGGEST: 'modelo-inventado' }, () => {
    assert.equal(modelForOperation('scenario-generation'), 'claude-sonnet-5-5');
  });
});

test('ALTERNATIVE_MODEL mapea Claude ↔ OpenAI con calidad equivalente', () => {
  assert.equal(ALTERNATIVE_MODEL['claude-haiku-5-5'], 'gpt-4o-mini');
  assert.equal(ALTERNATIVE_MODEL['claude-sonnet-5-5'], 'gpt-4o');
  assert.equal(ALTERNATIVE_MODEL['gpt-4o-mini'], 'claude-haiku-5-5');
  assert.equal(ALTERNATIVE_MODEL['gpt-4o'], 'claude-sonnet-5-5');
  assert.equal(ALTERNATIVE_MODEL['rule-based'], null);
});

function organizationBudget({ code, monthlyLimit, aiTokensUsed, withCapability = true }) {
  const prisma = {
    orgBudget: { async findUnique() { return { aiTokensUsed, aiCostCop: 3000 }; } },
    subscription: { async findUnique() {
      return { plan: { code, capabilities: withCapability ? [
        { code: 'AI_DOCUMENT_ANALYSIS', availability: 'OPERATIONAL', monthlyLimit },
        { code: 'AI_SCENARIO_GENERATION', availability: 'OPERATIONAL', monthlyLimit: null },
      ] : [] } };
    } },
  };
  return { prisma, budget: new BudgetService(prisma) };
}

test('Enterprise con límite nulo permite generar sobre el valor supletorio y conserva su consumo', async () => {
  const { budget } = organizationBudget({ code: 'enterprise', monthlyLimit: null, aiTokensUsed: 498_508 });
  const reading = await budget.getBudget('org');
  assert.equal(reading.aiTokensUsed, 498_508);
  assert.equal(reading.aiTokensLimit, null);
  assert.equal(reading.remainingTokens, null);
  await budget.ensureBudget('org', 3_000);
});

test('se respetan los límites explícitos y se conserva el valor supletorio si falta la capacidad', async () => {
  for (const [code, monthlyLimit, withCapability, expected] of [
    ['enterprise', 15_000_000, true, 15_000_000],
    ['enterprise', null, false, 500_000],
    ['business', null, true, 500_000],
    ['professional', 3_000_000, true, 3_000_000],
    ['essentials', 0, true, 0],
  ]) {
    const { budget } = organizationBudget({ code, monthlyLimit, withCapability, aiTokensUsed: expected });
    const reading = await budget.getBudget('org');
    assert.equal(reading.aiTokensLimit, expected);
    assert.equal(reading.remainingTokens, 0);
    await assert.rejects(budget.ensureBudget('org', 1), /Presupuesto IA/);
  }
});

test('el motivo de cuota llega al resultado de generación antes de llamar al proveedor', async () => {
  const { prisma, budget } = organizationBudget({ code: 'essentials', monthlyLimit: 500_000, aiTokensUsed: 498_508 });
  const router = new AiRouter(prisma, budget);
  router.providerCascade = () => { assert.fail('La cuota se valida antes de consultar el proveedor'); };
  const response = await router.dispatch({ organizationId: 'org', projectId: 'project', runKey: null,
    operation: 'scenario-generation', prompt: 'Genera casos.', maxOutputTokens: 3_000 });
  assert.equal(response.usedFallback, true);
  const summary = summarizeGeneration([{ type: 'functional_web', created: 0, model: response.model, usedFallback: true,
    errors: generationResponseErrors(response, false) }]);
  assert.equal(summary.outcomes[0].issue, 'ai-budget-exhausted');
});

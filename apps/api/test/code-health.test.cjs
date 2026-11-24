const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CodeHealthService } = require('../dist/quality/code-health.service');

function fixture(t, conclusions) {
  const keys = ['AUTOQA_GITHUB_TOKEN', 'AUTOQA_GITHUB_REPO', 'AUTOQA_GITHUB_WORKFLOW'];
  const original = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => {
    if (original[index] === undefined) delete process.env[key];
    else process.env[key] = original[index];
  }));
  process.env.AUTOQA_GITHUB_TOKEN = 'test-token';
  process.env.AUTOQA_GITHUB_REPO = 'example/autoqa';
  process.env.AUTOQA_GITHUB_WORKFLOW = 'ci.yml';
  const service = new CodeHealthService();
  t.mock.method(service, 'githubFetch', async path => {
    if (path.includes('/workflows/')) return { status: 200, body: {
      workflow_runs: conclusions.map((conclusion, index) => ({
        id: index + 1, status: conclusion ? 'completed' : 'in_progress', conclusion,
      })),
    } };
    if (path.includes('/code-scanning/')) return { status: 200, body: [
      { number: 1, rule: { security_severity_level: 'high', severity: 'note' } },
      { number: 2, rule: { severity: 'warning' } },
      { number: 3, rule: { severity: 'error' } },
      { number: 4, rule: { severity: 'note' } },
      { number: 5, rule: null },
    ] };
    if (path.includes('/dependabot/')) return { status: 200, body: [{ number: 1, security_advisory: { severity: 'medium' } }] };
    assert.fail('Unexpected GitHub request ' + path);
  });
  return service;
}

test('CodeQL prioriza la severidad de seguridad y contabiliza los niveles de código', async t => {
  const service = fixture(t, ['cancelled', 'success', 'failure', 'timed_out', 'startup_failure', 'skipped', null]);
  const health = await service.read();
  assert.deepEqual(health.codeql.counts, {
    critical: 0, high: 1, medium: 0, low: 0, error: 1, warning: 1, note: 1, other: 1, total: 5,
  });
  assert.equal(health.codeql.top[0].severity, 'high');
  assert.equal(health.dependabot.counts.medium, 1);
  assert.equal(health.workflow.evaluated, 4);
  assert.equal(health.workflow.succeeded, 1);
  assert.equal(health.workflow.successRate, 0.25);
  assert.equal(health.workflow.recent.length, 7);
});

test('un historial con cancelaciones y omisiones no produce un CI al cero por ciento', async t => {
  const { workflow } = await fixture(t, ['cancelled', 'skipped', null]).read();
  assert.equal(workflow.evaluated, 0);
  assert.equal(workflow.successRate, null);
});

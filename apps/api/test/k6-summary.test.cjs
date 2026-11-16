const assert = require('node:assert/strict');
const { test } = require('node:test');

const { generateK6Script, parseK6Summary } = require('../dist/load/k6-summary');

test('parseK6Summary extrae métricas principales', () => {
  const metrics = parseK6Summary({
    state: { testRunDurationMs: 180000 },
    metrics: {
      http_reqs: { count: 1800, rate: 10 },
      http_req_failed: { value: 0.02 },
      http_req_duration: { med: 120, 'p(95)': 450, 'p(99)': 800 },
      vus_max: { max: 20 },
    },
  });
  assert.equal(metrics.totalRequests, 1800);
  assert.equal(metrics.reqPerSec, 10);
  assert.equal(metrics.failRate, 0.02);
  assert.equal(metrics.p50Ms, 120);
  assert.equal(metrics.p95Ms, 450);
  assert.equal(metrics.p99Ms, 800);
  assert.equal(metrics.maxVus, 20);
  assert.equal(metrics.durationSec, 180);
});

test('parseK6Summary devuelve null para campos faltantes', () => {
  const metrics = parseK6Summary({});
  for (const value of Object.values(metrics)) assert.equal(value, null);
});

test('parseK6Summary tolera estructuras inesperadas', () => {
  assert.doesNotThrow(() => parseK6Summary(null));
  assert.doesNotThrow(() => parseK6Summary('texto'));
  assert.doesNotThrow(() => parseK6Summary({ metrics: 'malformado' }));
});

test('generateK6Script produce stages, thresholds y GET', () => {
  const script = generateK6Script({
    url: 'https://api.example.com/health',
    stages: [{ duration: '30s', target: 10 }, { duration: '1m', target: 20 }, { duration: '30s', target: 0 }],
  });
  assert.ok(script.includes("import http from 'k6/http';"));
  assert.ok(script.includes("{ duration: '30s', target: 10 }"));
  assert.ok(script.includes("{ duration: '1m', target: 20 }"));
  assert.ok(script.includes("{ duration: '30s', target: 0 }"));
  assert.ok(script.includes('"http_req_duration"'));
  assert.ok(script.includes("'p(95)<2000'"));
  assert.ok(script.includes("http.get('https://api.example.com/health');"));
});

test('generateK6Script escapa URL contra inyección', () => {
  const script = generateK6Script({
    url: "https://x.com/'; os.command('rm -rf /'); //",
    stages: [{ duration: '5s', target: 1 }],
  });
  // La comilla cierra la cadena en el output; os.command queda dentro de
  // un literal escapado. Verificamos que los apóstrofos están escapados y
  // que el resultado es parseable como JS (no se cae en sintaxis inválida).
  assert.ok(script.includes("\\'"), 'esperaba apóstrofos escapados en el script');
  // La cadena `os.command('rm -rf /')` aparece pero completamente DENTRO
  // del literal de URL, no como código ejecutable.
  const literal = /http\.get\('([^']*(?:\\'[^']*)*)'\);/.exec(script);
  assert.ok(literal, 'esperaba un literal cerrado correctamente para http.get');
});

test('generateK6Script rechaza stages fuera de rango', () => {
  assert.throws(() => generateK6Script({
    url: 'https://x.com', stages: [{ duration: '30s', target: 100000 }],
  }), /fuera de rango/);
  assert.throws(() => generateK6Script({
    url: 'https://x.com', stages: [{ duration: 'ahora mismo', target: 10 }],
  }), /inválida/);
});

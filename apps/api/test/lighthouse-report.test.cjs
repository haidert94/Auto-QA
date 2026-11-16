// Parseo puro del reporte Lighthouse. No lanza Chromium.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseLighthouseReport } = require('../dist/performance/lighthouse-report');

test('parseLighthouseReport convierte scores 0..1 a enteros 0..100', () => {
  const metrics = parseLighthouseReport({
    categories: {
      performance: { score: 0.92 },
      accessibility: { score: 0.78 },
      'best-practices': { score: 1.0 },
      seo: { score: 0.5 },
    },
    audits: {},
  });
  assert.equal(metrics.performanceScore, 92);
  assert.equal(metrics.accessibilityScore, 78);
  assert.equal(metrics.bestPracticesScore, 100);
  assert.equal(metrics.seoScore, 50);
});

test('parseLighthouseReport extrae métricas de audits', () => {
  const metrics = parseLighthouseReport({
    categories: {},
    audits: {
      'first-contentful-paint': { numericValue: 1234.56 },
      'largest-contentful-paint': { numericValue: 2500 },
      'total-blocking-time': { numericValue: 180 },
      'cumulative-layout-shift': { numericValue: 0.025 },
      'speed-index': { numericValue: 3400 },
    },
  });
  assert.equal(metrics.fcpMs, 1235);
  assert.equal(metrics.lcpMs, 2500);
  assert.equal(metrics.tbtMs, 180);
  assert.equal(metrics.cls, 0.025);
  assert.equal(metrics.siMs, 3400);
});

test('parseLighthouseReport devuelve null para campos faltantes', () => {
  const metrics = parseLighthouseReport({});
  for (const value of Object.values(metrics)) assert.equal(value, null);
});

test('parseLighthouseReport ignora score null (categoría desactivada)', () => {
  const metrics = parseLighthouseReport({
    categories: { performance: { score: null } },
    audits: {},
  });
  assert.equal(metrics.performanceScore, null);
});

test('parseLighthouseReport tolera objetos sin la forma esperada', () => {
  assert.doesNotThrow(() => parseLighthouseReport(null));
  assert.doesNotThrow(() => parseLighthouseReport(undefined));
  assert.doesNotThrow(() => parseLighthouseReport('texto que no es reporte'));
});

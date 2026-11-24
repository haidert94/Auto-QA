const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require('playwright');
const { runUxAudit } = require('../dist/explorer/src/ux-runner');

test('Explorer escribe los hallazgos UX en la base y guarda solo la captura como archivo', async t => {
  const png = Buffer.from([137, 80, 78, 71]);
  t.mock.method(chromium, 'launch', async () => ({
    async newContext() { return { async newPage() { return {
      async goto() {},
      async screenshot() { return png; },
      async evaluate() { return { title: 'Catálogo' }; },
    }; } }; },
    async close() {},
  }));
  const claim = { id: 'ux', projectId: 'proyecto', environmentId: 'qa', url: 'https://example.test/', runKey: 'auditoria' };
  const updates = [], uploads = [];
  const prisma = {
    project: { async findUnique() { return { organizationId: 'equipo' }; } },
    uxAudit: { async updateMany(update) { updates.push(update); return { count: 1 }; } },
  };
  const screenshotKey = 'a'.repeat(32);
  const storage = { async put(bytes, options) { uploads.push({ bytes, options }); return screenshotKey; } };
  const router = { async dispatch() { return { model: 'modelo-prueba', text: JSON.stringify({
    overallSummary: 'Revisión de UX',
    findings: [null, { summary: 'Campo sin etiqueta', recommendation: 'Agregar etiqueta', severity: 'major' }],
    screenshotKey: 'clave ajena al almacenamiento',
  }) }; } };

  await runUxAudit(prisma, claim, storage, router);
  assert.deepEqual(uploads, [{ bytes: png, options: { contentType: 'image/png' } }]);
  assert.equal(updates.length, 1);
  const [{ data }] = updates;
  assert.equal(data.status, 'COMPLETED');
  assert.equal(data.totalFindings, 1);
  assert.equal(data.majorCount, 1);
  assert.equal(data.reportKey, null);
  assert.equal(data.screenshotKey, screenshotKey);
  assert.deepEqual(data.reportDetails, {
    overallSummary: 'Revisión de UX', model: 'modelo-prueba',
    findings: [{ summary: 'Campo sin etiqueta', recommendation: 'Agregar etiqueta', severity: 'major', heuristic: '', selector: '' }],
  });
});

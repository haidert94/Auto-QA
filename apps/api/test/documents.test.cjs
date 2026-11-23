const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdtemp, readdir, rmdir, unlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { after, before, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');

const testUrl = process.env.AUTOQA_TEST_DATABASE_URL;
if (!testUrl) throw new Error('Configura AUTOQA_TEST_DATABASE_URL con una base PostgreSQL de pruebas migrada.');

const token = randomBytes(32).toString('hex');
const authorized = { Authorization: 'Bearer ' + token };
let app;
let prisma;
let api;
let storage;
const projects = new Set();

before(async () => {
  process.env.DATABASE_URL = testUrl;
  process.env.AUTOQA_LEGACY_MODE = 'true';
  process.env.AUTOQA_DOCUMENTS_TOKEN = token;
  storage = await mkdtemp(join(tmpdir(), 'autoqa-documents-test-'));
  process.env.AUTOQA_DOCUMENTS_DIR = storage;
  prisma = new PrismaClient({ datasourceUrl: testUrl });
  const { createApp } = require('../dist/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  api = (await app.getUrl()) + '/api/projects';
});

after(async () => {
  try {
    if (prisma && projects.size) await prisma.project.deleteMany({ where: { id: { in: [...projects] } } });
  } finally {
    await Promise.all([app?.close(), prisma?.$disconnect()]);
    if (storage) {
      for (const name of await readdir(storage)) await unlink(join(storage, name));
      await rmdir(storage);
    }
  }
});

async function request(path, options = {}) {
  const response = await fetch(api + path, { signal: AbortSignal.timeout(50000), ...options });
  return {
    status: response.status,
    data: response.status === 204 ? null : await response.json(),
  };
}

async function project(name) {
  const result = await request('', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  assert.equal(result.status, 201);
  projects.add(result.data.id);
  return '/' + result.data.id + '/documents';
}

function upload(path, files, type = 'AUTO', headers = authorized, testTypes) {
  const body = new FormData();
  body.append('type', type);
  if (testTypes) body.append('testTypes', JSON.stringify(testTypes));
  for (const [name, content] of files) body.append('files', new Blob([content]), name);
  return request(path, { method: 'POST', headers, body });
}

function read(path) {
  return request(path, { headers: authorized });
}

test('protects metadata and enforces project ownership at every document endpoint', async () => {
  const first = await project('Documentos A');
  const second = await project('Documentos B');
  assert.equal((await request(first)).status, 401);
  assert.equal((await upload(first, [['prueba.txt', 'RF-1: Mostrar estado.']], 'AUTO', {})).status, 401);
  const testTypes = ['functional_web', 'mobile_emulated', 'compatibility', 'availability', 'performance', 'ux', 'manual'];
  const created = await upload(first, [['Catálogo.md', 'RF-1: Mostrar estado.']], 'REQUIREMENTS', authorized, testTypes);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const [doc] = created.data;
  assert.equal(doc.filename, 'Catálogo.md');
  assert.equal(doc.currentVersion.format, 'MD');
  assert.equal(doc.state, 'UPLOADED');
  assert.equal(doc.classificationSource, 'MANUAL');
  const saved = await read(first + '/' + doc.id);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.testTypes, testTypes);
  assert.deepEqual((await read(second)).data, []);
  assert.equal((await read(second + '/' + doc.id)).status, 404);
  assert.equal((await request(second + '/' + doc.id, { method: 'DELETE', headers: authorized })).status, 404);
  assert.equal((await request(second + '/' + doc.id + '/validation', {
    method: 'PATCH', headers: { ...authorized, 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId: doc.currentVersion.id, validated: true }),
  })).status, 404);
  assert.deepEqual((await request(first.replace('/documents', ''))).data.documents, []);
  assert.doesNotMatch(JSON.stringify(doc), /storageKey|sha256/);
  assert.ok((await readdir(storage)).every(name => /^[0-9a-f]{32}$/.test(name)));
});

test('suggests test types by file and preserves a manual assignment when versions change', async () => {
  const path = await project('Sugerencias por documento');
  const uploadBatch = await upload(path, [
    ['web.md', 'HU-1: Iniciar sesión en el catálogo.'],
    ['mobile.txt', 'El diseño adaptativo requiere pantallas pequeñas.'],
  ]);
  assert.equal(uploadBatch.status, 201, JSON.stringify(uploadBatch.data));
  const [web, mobile] = uploadBatch.data;
  assert.deepEqual(web.testTypes, ['functional_web']);
  assert.deepEqual(mobile.testTypes, ['mobile_emulated']);
  assert.equal(web.testTypesSource, 'AUTOMATIC');
  assert.equal(web.state, 'UPLOADED');
  const revised = await upload(path, [['mobile.txt', 'Debe cumplir WCAG.']]);
  assert.deepEqual(revised.data[0].testTypes, ['ux']);
  const manual = await request(path + '/' + web.id + '/test-types', {
    method: 'PATCH', headers: { ...authorized, 'Content-Type': 'application/json' },
    body: JSON.stringify({ testTypes: [] }),
  });
  assert.equal(manual.status, 200);
  assert.equal(manual.data.testTypesSource, 'MANUAL');
  const next = await upload(path, [['web.md', 'Medir la latencia del inicio de sesión.']]);
  assert.equal(next.data[0].id, web.id);
  assert.deepEqual(next.data[0].testTypes, []);
  assert.equal(next.data[0].testTypesSource, 'MANUAL');
  assert.deepEqual((await read(path + '/' + web.id)).data.testTypes, []);
});

test('reviews a stored PDF without uploading another version or changing a manual assignment', async () => {
  const path = await project('Revisión del PDF existente');
  const PDFDocument = require('pdfkit');
  const pdf = new PDFDocument();
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.once('error', reject);
    pdf.once('end', () => resolve(Buffer.concat(chunks)));
    pdf.text('Se requiere compatibilidad entre navegadores Chrome y Firefox.');
    pdf.end();
  });
  const created = await upload(path, [['software.pdf', buffer]]);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const [doc] = created.data;
  assert.deepEqual(doc.testTypes, ['compatibility']);
  await prisma.document.update({ where: { id: doc.id }, data: { testTypes: [], testTypesSource: 'PENDING' } });
  const route = path + '/' + doc.id + '/test-types';
  const reviewed = await request(route, { method: 'POST', headers: authorized });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.deepEqual(reviewed.data.testTypes, ['compatibility']);
  assert.equal(reviewed.data.testTypesSource, 'AUTOMATIC');
  assert.equal(reviewed.data.currentVersion.id, doc.currentVersion.id);
  assert.equal(reviewed.data.versions.length, 1);
  await request(route, {
    method: 'PATCH', headers: { ...authorized, 'Content-Type': 'application/json' },
    body: JSON.stringify({ testTypes: ['ux'] }),
  });
  const retry = await request(route, { method: 'POST', headers: authorized });
  assert.deepEqual(retry.data.testTypes, ['ux']);
  assert.equal(retry.data.testTypesSource, 'MANUAL');
});

test('rejects unsupported contents and preserves all-or-nothing upload', async () => {
  const path = await project('Validación documental');
  assert.equal((await upload(path, [['vale.md', 'RF-1: Texto.'], ['falso.pdf', 'No es PDF.']])).status, 415);
  assert.equal((await upload(path, [['../fuera.md', 'RF-1: Texto.']])).status, 400);
  assert.equal((await upload(path, [['sin-tipo.exe', 'Texto']])).status, 415);
  assert.equal((await upload(path, [['valido.md', 'Texto']], 'NO_EXISTE')).status, 400);
  assert.equal((await upload(path, [['grande.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 0x61)]])).status, 413);
  assert.deepEqual((await read(path)).data, []);
  assert.equal((await request(path + '/analyze', { method: 'POST', headers: authorized })).status, 400);
});

test('analyzes, reviews, versions and removes documents with their source-derived data', async () => {
  const path = await project('Análisis e IPA');
  const text = [
    'Historia de usuario: Como lector quiero abrir el catálogo.',
    'RF-1: Mostrar el total.', 'Criterio de aceptación: [RF-1] La factura muestra el total.',
    'RNF-1: Cargar en menos de 2 segundos.', 'RF-2: La búsqueda es rápida.',
    'Rol: Lector', 'Permiso: Lector puede consultar', 'RN-1: La moneda es COP.',
  ].join('\n');
  const uploadResult = await upload(path, [
    ['análisis.md', text], ['reglas.txt', 'RN-1: La moneda es USD.'],
  ]);
  assert.equal(uploadResult.status, 201, JSON.stringify(uploadResult.data));
  const [doc, rules] = uploadResult.data;
  const prior = (await read(path + '/analysis')).data;
  assert.equal(prior.analysis, null);
  assert.equal(prior.ipa.documents.uploaded, 2);
  assert.equal(prior.ipa.documents.processed, 0);
  const review = (versionId, validated) => request(path + '/' + doc.id + '/validation', {
    method: 'PATCH', headers: { ...authorized, 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId, validated }),
  });
  assert.equal((await review(doc.currentVersion.id, true)).status, 409);

  const result = await request(path + '/analyze', { method: 'POST', headers: authorized });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const { analysis, ipa } = result.data;
  assert.equal(ipa.status, 'BLOCKED');
  assert.equal(ipa.documents.processed, 2);
  assert.equal(ipa.verifiable, 1);
  assert.equal(ipa.documents.validated, 0);
  const conflict = analysis.findings.find(item => item.kind === 'CONTRADICTION');
  assert.deepEqual(new Set([conflict.source.filename, conflict.relatedSource.filename]), new Set(['análisis.md', 'reglas.txt']));
  assert.ok(analysis.findings.every(item => item.source.versionId && item.source.locator));
  const criterion = await prisma.acceptanceCriterion.findFirstOrThrow({ where: { analysisId: analysis.id }, include: { requirement: true } });
  assert.equal(criterion.requirement.externalKey, 'RF-1');
  assert.equal(await prisma.qualityAssessment.count({ where: { analysisId: analysis.id, type: 'READINESS' } }), 1);
  const reused = await request(path + '/analyze', { method: 'POST', headers: authorized });
  assert.equal(reused.data.analysis.id, analysis.id);
  const reviewed = await review(doc.currentVersion.id, true);
  assert.equal(reviewed.data.state, 'VALIDATED');
  assert.ok((await read(path + '/analysis')).data.ipa.score > ipa.score);
  assert.equal((await read(path + '/' + rules.id)).data.classificationSource, 'AUTOMATIC');

  const same = await upload(path, [['análisis.md', text]]);
  assert.equal(same.data[0].currentVersion.id, doc.currentVersion.id);
  const next = await upload(path, [['análisis.md', 'RF-5: Mostrar la moneda.']]);
  assert.equal(next.data[0].id, doc.id);
  assert.equal(next.data[0].versions.length, 2);
  assert.equal(next.data[0].state, 'UPLOADED');
  assert.equal((await review(doc.currentVersion.id, true)).status, 409);
  assert.equal((await read(path + '/analysis')).data.analysis, null);
  const keys = await prisma.documentVersion.findMany({ where: { documentId: doc.id }, select: { storageKey: true } });
  const removed = await request(path + '/' + doc.id, { method: 'DELETE', headers: authorized });
  assert.equal(removed.status, 204);
  assert.equal((await read(path + '/' + doc.id)).status, 404);
  assert.equal(await prisma.documentAnalysis.count({ where: { id: analysis.id } }), 0);
  const remaining = await readdir(storage);
  for (const row of keys) assert.ok(!remaining.includes(row.storageKey));
  assert.equal((await read(path)).data.length, 1);
});

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

test('detecta disponibilidad en Excel y recalcula sugerencias guardadas sin subir otra versión', async () => {
  const path = await project('Disponibilidad en Excel');
  const ExcelJS = require('exceljs');
  const book = new ExcelJS.Workbook();
  const stories = book.addWorksheet('Historias de usuario');
  stories.addRow(['Historias de la aplicación']);
  stories.addRow(['Historia', 'Categoría', 'Prioridad', 'Criterio de aceptación']);
  stories.addRow(['HU-D04', 'Disponibilidad', 'Media', 'Registra fecha, hora y resultado de cada intento programado.']);
  const uploaded = await upload(path, [['historias.xlsx', await book.xlsx.writeBuffer()]]);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  const [doc] = uploaded.data;
  assert.ok(doc.testTypes.includes('availability'));

  // Simula una sugerencia guardada con la regla anterior.
  await prisma.document.update({
    where: { id: doc.id },
    data: { testTypes: doc.testTypes.filter(type => type !== 'availability') },
  });
  const refreshed = await request(path + '/' + doc.id + '/test-types', { method: 'POST', headers: authorized });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
  assert.deepEqual(refreshed.data.testTypes, doc.testTypes);
  assert.equal(refreshed.data.testTypesSource, 'AUTOMATIC');
  assert.equal(refreshed.data.currentVersion.id, doc.currentVersion.id);
  assert.equal(refreshed.data.versions.length, 1);
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

  const typesPath = path + '/' + doc.id + '/test-types';
  const setTypes = testTypes => request(typesPath, {
    method: 'PATCH', headers: { ...authorized, 'Content-Type': 'application/json' },
    body: JSON.stringify({ testTypes }),
  });
  assert.equal((await setTypes(['performance'])).status, 409);
  const duplicate = await upload(path, [['análisis.md', text]], 'AUTO', authorized, ['performance']);
  assert.equal(duplicate.data[0].state, 'VALIDATED');
  assert.deepEqual(duplicate.data[0].testTypes, reviewed.data.testTypes);
  await prisma.document.update({ where: { id: doc.id }, data: { testTypesSource: 'PENDING' } });
  assert.equal((await request(typesPath, { method: 'POST', headers: authorized })).status, 409);
  assert.deepEqual((await read(path + '/' + doc.id)).data.testTypes, reviewed.data.testTypes);
  assert.equal((await review(doc.currentVersion.id, false)).data.state, 'PROCESSED');
  const reclassified = await setTypes(['performance']);
  assert.equal(reclassified.status, 200, JSON.stringify(reclassified.data));
  assert.deepEqual(reclassified.data.testTypes, ['performance']);
  assert.equal((await review(doc.currentVersion.id, true)).data.state, 'VALIDATED');

  const pending = analysis.findings.find(item => item.pendingConfirmation && item.requirementId && item.text.includes('búsqueda'));
  assert.ok(pending);
  const { currentScenarioRequirements } = require('../dist/documents/document-records');
  const projectId = path.split('/')[1];
  const beforeCorrection = await currentScenarioRequirements(prisma, projectId, true);
  assert.ok(beforeCorrection.requirements.length > 0);
  assert.ok(!beforeCorrection.requirements.some(item => item.id === pending.requirementId));
  const scenario = await prisma.testScenario.create({ data: {
    projectId, requirementId: pending.requirementId, title: 'Búsqueda existente', steps: [{ ordinal: 1, action: 'navigate: /' }],
  } });
  const run = await prisma.testRun.create({ data: { projectId, scenarioId: scenario.id, status: 'COMPLETED' } });
  const clarify = (body, docsPath = path) => request(docsPath + '/analysis/' + pending.id + '/clarification', {
    method: 'PATCH', headers: { ...authorized, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const correction = { text: 'La búsqueda devuelve resultados en menos de 2 segundos.',
    criterion: 'Dados diez productos, al buscar una coincidencia, aparece en menos de 2 segundos.',
    filename: 'correccion.md' };
  assert.equal((await clarify({ ...correction, criterion: ' ' })).status, 400);
  const otherProject = await project('Aclaración de otro proyecto');
  assert.equal((await clarify(correction, otherProject)).status, 404);
  const clarified = await clarify(correction);
  assert.equal(clarified.status, 200, JSON.stringify(clarified.data));
  assert.deepEqual(clarified.data.affectedScenarios, [{ id: scenario.id, title: scenario.title }]);
  const { data: current } = await read(path + '/analysis');
  assert.equal(current.analysis.id, analysis.id);
  assert.equal(current.ipa.verifiable, ipa.verifiable + 1);
  assert.equal(current.ipa.ambiguous, ipa.ambiguous - 1);
  const finding = current.analysis.findings.find(item => item.id === pending.id);
  assert.equal(finding.text, pending.text);
  assert.deepEqual(finding.source, pending.source);
  assert.equal(finding.clarification.text, correction.text);
  const confirmed = (await currentScenarioRequirements(prisma, projectId, true)).requirements
    .find(item => item.id === pending.requirementId);
  assert.equal(confirmed.title, correction.text);
  assert.ok(confirmed.criteria.some(item => item.text === correction.criterion));
  assert.equal(confirmed.sources[0].clarification.filename, 'correccion.md');
  assert.deepEqual(confirmed.scenarios, [{ tags: [] }]);
  assert.equal((await clarify(correction)).status, 409);
  const reviewedScenario = await prisma.testScenario.findUniqueOrThrow({ where: { id: scenario.id } });
  assert.ok(reviewedScenario.requirementReviewRequiredAt);
  const acknowledgement = reviewedRequirementAt => request('/' + projectId + '/scenarios/' + scenario.id, {
    method: 'PATCH', headers: { ...authorized, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewedRequirementAt }),
  });
  assert.equal((await acknowledgement(new Date(0).toISOString())).status, 409);
  assert.equal((await acknowledgement(reviewedScenario.requirementReviewRequiredAt.toISOString())).status, 200);
  assert.equal((await prisma.testScenario.findUniqueOrThrow({ where: { id: scenario.id } })).requirementReviewRequiredAt, null);
  assert.equal((await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })).scenarioId, scenario.id);

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

async function authorizeTestProject(projectId) {
  await prisma.project.update({ where: { id: projectId }, data: { status: 'READY', ownerLabel: 'QA' } });
  return prisma.environment.create({ data: {
    projectId, type: 'QA', accessMode: 'PUBLIC', baseUrl: 'https://example.test', allowedHosts: ['example.test'],
    allowedPaths: [{ host: 'example.test', path: '/' }], authorizationConfirmed: true, authorizedAt: new Date(),
  } });
}

test('un criterio sin historia bloquea la generación desde la API aun con una historia verificada', async () => {
  const path = await project('Trazabilidad obligatoria');
  const projectId = path.split('/')[1];
  await authorizeTestProject(projectId);
  const text = [
    'HU-01: Como usuario quiero abrir el catálogo.',
    'Criterio de aceptación: [HU-01] Se muestra el título del catálogo.',
  ];
  const sendDocs = lines => upload(path, [['historias.md', lines.join('\n')]], 'REQUIREMENTS', authorized, ['functional_web']);
  const runAnalysis = () => request(path + '/analyze', { method: 'POST', headers: authorized });
  const createCases = () => request('/' + projectId + '/automation', {
    method: 'POST', headers: { ...authorized, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.test', documentTestTypes: ['functional_web'] }),
  });
  const bad = await sendDocs([...text, 'Criterio de aceptación: [HU-999] Se muestra un mensaje.']);
  assert.equal(bad.status, 201);
  const blocked = await runAnalysis();
  assert.equal(blocked.status, 200);
  assert.equal(blocked.data.ipa.status, 'BLOCKED');
  assert.equal(blocked.data.ipa.score, 69);
  assert.equal((await createCases()).status, 409);

  const good = await sendDocs(text);
  assert.equal(good.status, 201);
  const ready = await runAnalysis();
  assert.equal(ready.status, 200);
  assert.equal(ready.data.ipa.status, 'ASSESSED');
  assert.ok(ready.data.ipa.score >= 70);
  assert.equal((await createCases()).status, 201);
});

test('al agregar un documento de Performance se excluyen los tipos ya generados', async () => {
  const path = await project('Generación de documentación complementaria');
  const projectId = path.split('/')[1];
  const base = '/' + projectId + '/automation';
  const environment = await authorizeTestProject(projectId);
  const uploadWeb = await upload(path, [['web.md', [
    'RF-1: Mostrar el catálogo.',
    'Criterio de aceptación: [RF-1] Aparece el título del catálogo.',
  ].join('\n')]], 'REQUIREMENTS', authorized, ['functional_web', 'manual']);
  assert.equal(uploadWeb.status, 201, JSON.stringify(uploadWeb.data));
  const analyze = () => request(path + '/analyze', { method: 'POST', headers: authorized });
  const first = await analyze();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const original = first.data.analysis.findings.find(item => item.requirementId && item.text.includes('Mostrar el catálogo'));
  assert.ok(original?.requirementId);
  const scenario = await prisma.testScenario.create({ data: {
    projectId, requirementId: original.requirementId, title: 'Consultar el catálogo',
    steps: [{ ordinal: 1, action: 'expect-text: Catálogo' }], tags: ['@funcional'],
  } });
  await prisma.testScenario.create({ data: {
    projectId, requirementId: original.requirementId, title: 'Revisar el catálogo manualmente',
    steps: [{ ordinal: 1, action: 'Abre el catálogo.', expected: 'El título Catálogo está visible.' }], tags: ['@manual'],
  } });
  await prisma.automationJob.create({ data: {
    projectId, status: 'COMPLETED', stage: 'generated',
    inputs: { documentAnalysisId: first.data.analysis.id },
    result: { generation: { outcomes: [
      { type: 'functional_web', created: 1, errorCount: 0 }, { type: 'manual', created: 1, errorCount: 0 },
    ] } },
  } });

  const uploadPerf = await upload(path, [['performance.md', [
    'RNF-2: La carga del catálogo tarda menos de dos segundos.',
    'Criterio de aceptación: [RNF-2] El catálogo carga en menos de dos segundos.',
  ].join('\n')]], 'REQUIREMENTS', authorized, ['performance']);
  assert.equal(uploadPerf.status, 201, JSON.stringify(uploadPerf.data));
  const beforeAnalysis = await read(base + '/types/pending');
  assert.equal(beforeAnalysis.status, 200, JSON.stringify(beforeAnalysis.data));
  assert.equal(beforeAnalysis.data.hasCurrentAnalysis, false);
  const second = await analyze();
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.notEqual(first.data.analysis.id, second.data.analysis.id);

  const pending = await read(base + '/types/pending');
  assert.equal(pending.status, 200, JSON.stringify(pending.data));
  assert.deepEqual(pending.data.types, [{ code: 'performance', available: true }]);
  assert.equal(pending.data.verifiable, 1);
  const createJob = documentTestTypes => request(base, {
    method: 'POST', headers: { ...authorized, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.test', documentTestTypes }),
  });
  assert.equal((await createJob(['functional_web', 'manual', 'performance'])).status, 409);
  async function queuePerformance() {
    const job = await createJob(['performance']);
    assert.equal(job.status, 201, JSON.stringify(job.data));
    const selection = await request(base + '/' + job.data.id + '/select', {
      method: 'POST', headers: { ...authorized, 'Content-Type': 'application/json' },
      body: JSON.stringify({ types: ['performance'] }),
    });
    assert.equal(selection.status, 201, JSON.stringify(selection.data));
    return prisma.automationJob.findUniqueOrThrow({ where: { id: job.data.id } });
  }
  const empty = await queuePerformance();
  const { runAutomation } = require('../dist/automation/pipeline-runner');
  await runAutomation(prisma, {
    id: empty.id, projectId, inputs: empty.inputs, runKey: empty.runKey, priorStage: empty.stage,
  }, {
    async dispatch() { return { model: 'rule-based', usedFallback: true, text: 'Sin respuesta del proveedor.' }; },
  });
  const failed = await read(base + '/' + empty.id);
  assert.equal(failed.data.status, 'FAILED');
  assert.equal(failed.data.errorCode, 'generation-empty');
  assert.equal(failed.data.result.generation.totalCreated, 0);
  assert.equal(failed.data.result.generation.outcomes[0].issue, 'ai-unavailable');
  assert.equal(await prisma.performanceAudit.count({ where: { projectId } }), 0);
  assert.deepEqual((await read(base + '/types/pending')).data.types, [{ code: 'performance', available: true }]);
  const saved = await queuePerformance();
  assert.deepEqual(saved.inputs.selection, ['performance']);
  assert.deepEqual(saved.inputs.documentGenerationSources, {
    performance: [{ versionId: uploadPerf.data[0].currentVersion.id, clarifiedAt: null }],
  });
  assert.equal(saved.stage, 'generation-batch-ready');
  const perfRequirement = second.data.analysis.findings.find(item => item.kind === 'NON_FUNCTIONAL' && item.requirementId);
  assert.ok(perfRequirement);
  const prompts = [];
  await runAutomation(prisma, {
    id: saved.id, projectId, inputs: saved.inputs, runKey: saved.runKey, priorStage: saved.stage,
  }, {
    async dispatch({ prompt }) {
      prompts.push(prompt);
      return { model: 'test', text: JSON.stringify({ audits: [
        { url: 'https://example.test/catalogo', requirementId: perfRequirement.requirementId },
        { url: 'https://example.test/sin-vinculo' },
      ], loadTests: [] }) };
    },
  });
  const finished = await read(base + '/' + saved.id);
  assert.equal(finished.status, 200);
  assert.equal(finished.data.stage, 'generated', JSON.stringify(finished.data));
  assert.equal(finished.data.status, 'COMPLETED');
  assert.equal(finished.data.errorCode, null);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /menos de dos segundos/);
  assert.doesNotMatch(prompts[0], /Mostrar el catálogo/);
  assert.equal(await prisma.performanceAudit.count({ where: { projectId, environmentId: environment.id } }), 1);
  const audit = await prisma.performanceAudit.findFirstOrThrow({ where: { projectId } });
  assert.equal(audit.requirementId, perfRequirement.requirementId);
  assert.equal(await prisma.testScenario.count({ where: { projectId } }), 2);
  assert.equal((await prisma.testScenario.findUniqueOrThrow({ where: { id: scenario.id } })).requirementId, original.requirementId);
});

test('completa la cobertura en lotes y recupera historias omitidas por una generación anterior', async () => {
  const path = await project('Generación por categoría');
  const projectId = path.split('/')[1];
  const base = '/' + projectId + '/automation';
  await authorizeTestProject(projectId);
  const types = ['functional_web', 'mobile_emulated', 'manual'];
  const functional = Array.from({ length: 22 }, (_, i) => {
    const number = i + 10;
    return [
      `HU-${number},Historia de usuario,Funcional web,Consultar la sección ${number} del catálogo.,`,
      `CA-${number},Criterio de aceptación,,Se muestra el catálogo de la sección ${number}.,HU-${number}`,
    ];
  }).flat();
  const file = await upload(path, [['historias.csv', [
    'ID,Tipo,Categoría,Texto,Requisito',
    ...functional,
    'HU-M01,Historia de usuario,Móvil emulado,Consultar la cesta en una pantalla de 390 por 844 píxeles.,',
    'CA-101,Criterio de aceptación,,El total de la cesta queda visible.,HU-M01',
    'HU-X01,Historia de usuario,Casos manuales,Comprobar manualmente el recibo PDF.,',
    'CA-102,Criterio de aceptación,,El recibo incluye el total del pedido.,HU-X01',
  ].join('\n')]], 'REQUIREMENTS', authorized, types);
  assert.equal(file.status, 201, JSON.stringify(file.data));
  const analysis = await request(path + '/analyze', { method: 'POST', headers: authorized });
  assert.equal(analysis.status, 200, JSON.stringify(analysis.data));
  const versionId = file.data[0].currentVersion.id;
  const source = [{ versionId, clarifiedAt: null }];
  const web = await prisma.requirement.findFirstOrThrow({ where: { projectId, externalKey: 'HU-10' } });
  await prisma.testScenario.create({ data: {
    projectId, requirementId: web.id, title: 'Consultar catálogo',
    steps: [{ ordinal: 1, action: 'expect-text: Catálogo' }], tags: ['@funcional'],
  } });
  await prisma.automationJob.create({ data: {
    projectId, status: 'COMPLETED', stage: 'generated',
    inputs: { documentAnalysisId: analysis.data.analysis.id, documentGenerationSources: Object.fromEntries(types.map(type => [type, source])) },
    result: { generation: { outcomes: types.map(type => ({ type, created: Number(type === 'functional_web'), errorCount: 0 })) } },
  } });
  const pending = await read(base + '/types/pending');
  const remaining = types;
  assert.deepEqual(pending.data.types, remaining.map(code => ({ code, available: true })));
  const { runAutomation } = require('../dist/automation/pipeline-runner');
  const attempts = new Map();
  let omitted = 'HU-31';
  const router = {
    async dispatch({ prompt }) {
      if (prompt.includes('Traslada las historias seleccionadas a un navegador móvil')) {
        assert.match(prompt, /HU-M01/);
        assert.doesNotMatch(prompt, /HU-X01|Consultar la sección/);
        return { model: 'test', text: JSON.stringify({ scenarios: [{
          title: 'Consultar cesta en móvil', mode: 'playwright', requirementId: 'HU-M01',
          steps: [{ action: 'navigate: /cesta' }, { action: 'expect-text: Total' }],
        }] }) };
      }
      if (prompt.includes('Genera hasta 5 casos manuales')) {
        assert.match(prompt, /HU-X01/);
        assert.doesNotMatch(prompt, /Consultar la sección/);
        return { model: 'test', text: JSON.stringify({ scenarios: [{
          title: 'Revisar recibo manualmente', mode: 'manual', requirementId: 'HU-X01',
          expectedResult: 'El recibo incluye el total.', steps: [{ action: 'Abre el recibo.', expected: 'Se muestra el total.' }],
        }] }) };
      }
      const keys = [...new Set([...prompt.matchAll(/\[(HU-\d+)\]/g)].map(match => match[1]))];
      assert.ok(keys.length > 0 && keys.length <= 3, 'El generador reintenta con lotes internos acotados.');
      assert.ok(!keys.includes('HU-10'), 'El escenario que ya existe satisface su historia.');
      for (const key of keys) attempts.set(key, (attempts.get(key) ?? 0) + 1);
      return { model: 'test', text: JSON.stringify({ scenarios: keys.filter(key => key !== omitted).map(key => ({
        title: 'Mostrar sección ' + key, mode: 'playwright', requirementId: key,
        steps: [{ action: 'navigate: /catalogo' }, { action: 'expect-text: Sección ' + key.slice(3) }],
      })) }) };
    },
  };
  async function generate() {
    const job = await request(base, {
      method: 'POST', headers: { ...authorized, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test', documentTestTypes: remaining }),
    });
    assert.equal(job.status, 201, JSON.stringify(job.data));
    const selected = await request(base + '/' + job.data.id + '/select', {
      method: 'POST', headers: { ...authorized, 'Content-Type': 'application/json' },
      body: JSON.stringify({ types: remaining }),
    });
    assert.equal(selected.status, 201, JSON.stringify(selected.data));
    const saved = await prisma.automationJob.findUniqueOrThrow({ where: { id: job.data.id } });
    assert.deepEqual(saved.inputs.documentRequirementTypes, { [versionId]: {
      functional_web: Array.from({ length: 22 }, (_, i) => 'HU-' + (i + 10)),
      mobile_emulated: ['HU-M01'], manual: ['HU-X01'],
    } });
    assert.equal(saved.inputs.documentGenerationSources.functional_web[0].coverageOnly, true);
    await runAutomation(prisma, {
      id: saved.id, projectId, inputs: saved.inputs, runKey: saved.runKey, priorStage: saved.stage,
    }, router);
    return read(base + '/' + saved.id);
  }

  const failed = await generate();
  assert.equal(failed.data.errorCode, 'generation-incomplete');
  assert.equal(failed.data.result.generation.totalCreated, 0);
  assert.deepEqual(failed.data.result.generation.coverage.missing.map(item => item.externalKey), ['HU-31']);
  assert.equal(attempts.get('HU-31'), 2);
  assert.ok([...attempts.entries()].every(([key, count]) => key === 'HU-31' || count === 1));
  assert.equal(await prisma.testScenario.count({ where: { projectId } }), 1);

  omitted = null;
  const completed = await generate();
  assert.equal(completed.data.status, 'COMPLETED', JSON.stringify(completed.data.result));
  assert.deepEqual(completed.data.result.generation.coverage, { total: 24, missing: [] });
  const generated = await prisma.testScenario.findMany({
    where: { projectId }, select: { tags: true, requirement: { select: { externalKey: true } } },
  });
  assert.equal(generated.length, 24);
  assert.equal(new Set(generated.map(item => item.requirement.externalKey)).size, 24);
  assert.equal(generated.find(item => item.tags.includes('@mobile')).requirement.externalKey, 'HU-M01');
  assert.equal(generated.find(item => item.tags.includes('@manual')).requirement.externalKey, 'HU-X01');
  assert.deepEqual((await read(base + '/types/pending')).data.types, []);
});

test('los siete tipos se guardan juntos y el lote entero sigue pendiente si un tipo o el guardado falla', async () => {
  const types = ['functional_web', 'mobile_emulated', 'compatibility', 'availability', 'performance', 'ux', 'manual'];
  const source = [
    '## Módulo: Catálogo',
    'HU-1: Consultar el catálogo web.',
    'Criterio de aceptación: [HU-1] La página muestra el título Catálogo.',
    'HU-2: Consultar el catálogo en navegador móvil.',
    'Criterio de aceptación: [HU-2] Se muestra Catálogo en pantalla móvil.',
    '## Módulo: [ACC] Acciones Contratista',
    'HU-3: Revisar el comprobante.',
    'Criterio de aceptación: [HU-3] El comprobante contiene la fecha del pedido.',
  ].join('\n');

  async function prepare(name) {
    const path = await project(name);
    const id = path.split('/')[1];
    await authorizeTestProject(id);
    const file = await upload(path, [['historias.md', source]], 'REQUIREMENTS', authorized, types);
    assert.equal(file.status, 201, JSON.stringify(file.data));
    const analysis = await request(path + '/analyze', { method: 'POST', headers: authorized });
    assert.equal(analysis.status, 200, JSON.stringify(analysis.data));
    return { id, path, analysisId: analysis.data.analysis.id };
  }
  const existing = await prepare('Proyecto que ya generó');
  const existingRequirement = await prisma.requirement.findFirstOrThrow({ where: { projectId: existing.id, externalKey: 'HU-1' } });
  await prisma.testScenario.create({ data: {
    projectId: existing.id, requirementId: existingRequirement.id, title: 'Catálogo del otro proyecto',
    tags: ['@funcional'], steps: [{ ordinal: 1, action: 'expect-text: Catálogo' }],
  } });
  await prisma.automationJob.create({ data: {
    projectId: existing.id, status: 'COMPLETED', stage: 'generated',
    inputs: { documentAnalysisId: existing.analysisId },
    result: { generation: { outcomes: types.map(type => ({ type, created: 1, errorCount: 0 })) } },
  } });

  const fresh = await prepare('Proyecto nuevo con la misma documentación');
  const base = '/' + fresh.id + '/automation';
  const pending = await read(base + '/types/pending');
  assert.deepEqual(pending.data.types.map(type => type.code), types);
  const extraRequirement = await prisma.requirement.create({ data: {
    projectId: fresh.id, title: 'Conservar un caso anterior',
  } });
  const extraScenario = await prisma.testScenario.create({ data: {
    projectId: fresh.id, requirementId: extraRequirement.id, title: 'Escenario existente',
    tags: ['@manual'], steps: [{ ordinal: 1, action: 'Consultar el caso existente.' }],
  } });
  const headers = { ...authorized, 'Content-Type': 'application/json' };
  async function queueBatch() {
    const job = await request(base, {
      method: 'POST', headers, body: JSON.stringify({ url: 'https://example.test', documentTestTypes: types }),
    });
    assert.equal(job.status, 201, JSON.stringify(job.data));
    const selected = await request(base + '/' + job.data.id + '/select', {
      method: 'POST', headers, body: JSON.stringify({ types }),
    });
    assert.equal(selected.status, 201, JSON.stringify(selected.data));
    return prisma.automationJob.findUniqueOrThrow({ where: { id: job.data.id } });
  }
  const { runAutomation } = require('../dist/automation/pipeline-runner');
  const retries = [];
  const expectedSteps = [{ action: 'navigate: /' }, { action: 'expect-text: Catálogo' }];
  let failManual = true;
  const router = {
    async dispatch({ prompt, operation }) {
      const url = 'https://example.test/';
      const quality = { requirementId: 'HU-1', url };
      const respond = json => ({ model: 'test', text: JSON.stringify(json) });
      if (operation === 'ux-analysis') return respond({ audits: [quality] });
      if (prompt.includes('"monitors"')) return respond({ monitors: [{ ...quality, name: 'Disponibilidad del catálogo' }] });
      if (prompt.includes('"loadTests"')) return respond({ audits: [quality], loadTests: [{ ...quality, name: 'Carga del catálogo' }] });
      if (prompt.includes('Traslada las historias seleccionadas a un navegador móvil')) {
        return respond({ scenarios: [{ title: 'Mostrar catálogo en móvil', requirementId: 'HU-2', steps: expectedSteps }] });
      }
      const manual = prompt.includes('Genera hasta 5 casos manuales');
      if (!prompt.includes('Segundo intento')) return { model: 'test', text: '{"scenarios":[{"title":"Respuesta cortada' };
      retries.push(manual ? 'manual' : 'functional_web');
      if (manual && failManual) return respond({ scenarios: [] });
      return manual ? respond({ scenarios: [{
        title: 'Revisar comprobante', mode: 'manual', requirementId: 'HU-3',
        expectedResult: 'El comprobante incluye la fecha del pedido.',
        steps: [{ action: 'Abre el comprobante.', expected: 'Se ve la fecha del pedido.' }],
      }] }) : respond({ scenarios: [{ title: 'Mostrar catálogo web', requirementId: 'HU-1', steps: expectedSteps }] });
    },
  };
  async function runBatch(database = prisma) {
    const job = await queueBatch();
    await runAutomation(database, {
      id: job.id, projectId: fresh.id, inputs: job.inputs, runKey: job.runKey, priorStage: job.stage,
    }, router);
    return read(base + '/' + job.id);
  }

  async function checkNoPartialCases() {
    const where = { projectId: fresh.id };
    assert.deepEqual(await prisma.testScenario.findMany({ where, select: { id: true } }), [{ id: extraScenario.id }]);
    assert.equal(await prisma.monitor.count({ where }), 0);
    assert.equal(await prisma.performanceAudit.count({ where }), 0);
    assert.equal(await prisma.loadTest.count({ where }), 0);
    assert.equal(await prisma.uxAudit.count({ where }), 0);
    assert.equal(await prisma.scenarioModuleSequence.count({ where }), 0);
    assert.deepEqual((await read(base + '/types/pending')).data.types.map(type => type.code), types);
  }

  const incomplete = await runBatch();
  assert.equal(incomplete.data.status, 'FAILED');
  assert.equal(incomplete.data.errorCode, 'generation-incomplete');
  assert.equal(incomplete.data.result.generation.totalCreated, 0);
  assert.ok(incomplete.data.result.generation.outcomes.every(outcome => outcome.created === 0));
  assert.equal(incomplete.data.result.generation.outcomes.find(outcome => outcome.type === 'manual').issue, 'no-cases');
  await checkNoPartialCases();

  failManual = false;
  let reachedLoadWrite = false;
  const databaseWithWriteError = new Proxy(prisma, {
    get(target, key) {
      if (key !== '$transaction') return target[key];
      return (fn, options) => target.$transaction(tx => fn(new Proxy(tx, {
        get(client, model) {
          if (model !== 'loadTest') return client[model];
          return { async createMany() {
            reachedLoadWrite = true;
            throw new Error('Error simulado al guardar la prueba de carga.');
          } };
        },
      })), options);
    },
  });
  const failedSave = await runBatch(databaseWithWriteError);
  assert.equal(reachedLoadWrite, true);
  assert.equal(failedSave.data.errorCode, 'generation-save-failed');
  await checkNoPartialCases();

  retries.length = 0;
  const finished = await runBatch();
  assert.deepEqual(retries.sort(), ['functional_web', 'manual']);
  assert.equal(finished.data.status, 'COMPLETED');
  assert.equal(finished.data.result.generation.totalCreated, 13);
  assert.deepEqual(finished.data.result.generation.outcomes.map(({ type }) => type).sort(), [...types].sort());
  assert.ok(finished.data.result.generation.outcomes.every(({ created, errorCount }) => created > 0 && errorCount === 0));
  assert.deepEqual((await read(base + '/types/pending')).data.types, []);
  assert.equal(await prisma.testScenario.count({ where: { projectId: existing.id } }), 1);
  const scenarioPath = '/' + fresh.id + '/scenarios';
  const scenarios = await read(scenarioPath);
  const quality = await read(scenarioPath + '/quality');
  assert.equal(scenarios.status, 200);
  assert.equal(quality.status, 200);
  const cases = [...scenarios.data, ...quality.data];
  assert.equal(cases.find(item => item.id === extraScenario.id).caseCode, null);
  assert.equal(cases.find(item => item.requirement?.externalKey === 'HU-3').caseCode, 'TC-ACC-001');
  assert.ok(quality.data.every(item => /^TC-CAT-/.test(item.caseCode)));
  const catalogCodes = cases.map(item => item.caseCode).filter(code => code?.startsWith('TC-CAT-')).sort();
  assert.deepEqual(catalogCodes, Array.from({ length: 12 }, (_, i) => 'TC-CAT-' + String(i + 1).padStart(3, '0')));
  assert.equal(await prisma.scenarioModuleSequence.count({ where: { projectId: existing.id } }), 0);
});

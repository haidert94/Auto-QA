const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { documentFormat, parseDocument } = require('../dist/documents/document-files');
const { RuleBasedDocumentAnalyzer, analyzeFindings } = require('../dist/documents/document-analysis');

const { attachDeclaredModules } = require('../dist/documents/document-modules');

test('asocia un módulo declarado con la historia y distingue historias sin módulo', async () => {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Historias');
  sheet.addRows([
    ['ID', 'Tipo', 'Historia de usuario', 'Módulo', 'Código de módulo'],
    ['HU-1', 'Historia de usuario', 'Como editor quiero guardar un contrato.', 'Acciones Contratista', 'ACC'],
    ['HU-2', 'Historia de usuario', 'Como editor quiero consultar un contrato.', '', ''],
  ]);
  const blocks = await parseDocument('XLSX', Buffer.from(await workbook.xlsx.writeBuffer()));
  const aiFindings = [
    { kind: 'USER_STORY', key: 'HU-1', text: 'Como editor quiero guardar un contrato.', source: { locator: 'ai#1' } },
    { kind: 'USER_STORY', key: 'HU-2', text: 'Como editor quiero consultar un contrato.', source: { locator: 'ai#2' } },
  ];
  attachDeclaredModules(aiFindings, blocks);
  assert.deepEqual(aiFindings.map(finding => finding.module), ['[ACC]', undefined]);
});

function pdfFixture() {
  const stream = 'BT /F1 12 Tf 20 100 Td (RF-3: Mostrar el total.) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((value, index) => {
    offsets.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + value + '\nendobj\n';
  });
  const start = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
  return Buffer.from(pdf);
}

const fixture = name => readFileSync(join(__dirname, 'fixtures', name));

test('reads each supported format and preserves source location', async t => {
  const text = 'RF-3: Mostrar el total.';
  const json = Buffer.from('{"tipo":"Requisito funcional","texto":"Mostrar el total."}');
  const yaml = Buffer.from('tipo: Requisito funcional\ntexto: Mostrar el total.\n');
  const cases = [
    ['PDF', pdfFixture(), /página 1/],
    ['DOCX', fixture('requisito.docx'), /párrafo 1/],
    ['XLSX', fixture('requisito.xlsx'), /hoja Registro, fila 2/],
    ['CSV', Buffer.from('id;tipo;texto\nRF-3;Requisito funcional;Mostrar el total.\n'), /línea 2/],
    ['TXT', Buffer.from(text), /línea 1/],
    ['MD', Buffer.from('# Requisitos\n- ' + text), /línea 2/],
    ['JSON', json, /^#$/],
    ['YAML', yaml, /^#$/],
    ['YML', yaml, /^#$/],
  ];
  const analyzer = new RuleBasedDocumentAnalyzer();
  for (const [format, bytes, location] of cases) {
    await t.test(format, async () => {
      const blocks = await parseDocument(format, bytes);
      const findings = await analyzer.extract({ versionId: 'source', blocks });
      assert.ok(findings.some(item =>
        item.kind === 'FUNCTIONAL' && item.text === 'Mostrar el total.' && location.test(item.source.locator)));
    });
  }
});

test('rejects forged formats, binary text, and unsafe filename components', async () => {
  assert.throws(() => documentFormat('../catalogo.md', 7), /nombre/);
  assert.throws(() => documentFormat('catalogo.exe', 7), /Formato/);
  assert.throws(() => documentFormat('catalogo.txt', 0), /5 MiB/);
  for (const [format, data] of [
    ['PDF', Buffer.from('%PDF-documento inventado')],
    ['DOCX', fixture('requisito.xlsx')],
    ['XLSX', fixture('requisito.docx')],
    ['TXT', Buffer.from([0x00, 0x03, 0x04])],
    ['JSON', Buffer.from('{"x":')],
    ['YAML', Buffer.from('base: &base [1]\nref: *base\n')],
    ['CSV', Buffer.from('simple texto sin tabla')],
  ]) {
    await assert.rejects(parseDocument(format, data), /contenido no corresponde/);
  }
});

test('keeps evidence for explicit criteria, ambiguity and possible conflicts', async () => {
  const analyzer = new RuleBasedDocumentAnalyzer();
  const left = await analyzer.extract({
    versionId: 'doc-a',
    blocks: [
      { locator: 'línea 1', text: 'RF-1: Mostrar el total.' },
      { locator: 'línea 2', text: 'Criterio de aceptación: [RF-1] La página muestra el total de la factura.' },
      { locator: 'línea 3', text: 'RF-2: El sistema es rápido.' },
      { locator: 'línea 4', text: 'RN-7: El cobro se registra en pesos.' },
      { locator: 'línea 5', text: 'El sistema debe mostrar ayuda.' },
      { locator: 'línea 6', text: 'Permiso: El lector puede ver facturas.' },
    ],
  });
  const right = await analyzer.extract({
    versionId: 'doc-b', blocks: [{ locator: 'página 1', text: 'RN-7: El cobro se registra en dólares.' }],
  });
  const all = analyzeFindings([...left, ...right]);
  assert.equal(all.find(fact => fact.key === 'RF-1').pendingConfirmation, false);
  assert.equal(all.find(fact => fact.key === 'RF-2').pendingConfirmation, true);
  assert.equal(all.find(fact => fact.kind === 'REQUIREMENT').pendingConfirmation, true);
  assert.equal(all.filter(fact => fact.kind === 'ACCEPTANCE_CRITERION').length, 1);
  assert.equal(all.find(fact => fact.kind === 'SCENARIO').relatedSource.locator, 'línea 2');
  const conflict = all.find(fact => fact.kind === 'CONTRADICTION');
  assert.deepEqual([conflict.source.versionId, conflict.relatedSource.versionId], ['doc-b', 'doc-a']);
  assert.equal(conflict.pendingConfirmation, true);
});

test('extracts nested specifications and OpenAPI operations without creating acceptance criteria', async () => {
  const analyzer = new RuleBasedDocumentAnalyzer();
  const bytes = Buffer.from(JSON.stringify({
    requirements: [{ id: 'RF-8', description: 'Mostrar saldo.', acceptanceCriteria: ['La página muestra el saldo.'] }],
    roles: ['Lector'],
  }));
  const fields = await parseDocument('JSON', bytes);
  const facts = analyzeFindings(await analyzer.extract({ versionId: 'json', blocks: fields }));
  const requirement = facts.find(item => item.kind === 'FUNCTIONAL');
  const criterion = facts.find(item => item.kind === 'ACCEPTANCE_CRITERION');
  assert.equal(requirement.pendingConfirmation, false);
  assert.equal(criterion.source.locator, '#/requirements/0/acceptanceCriteria/0');
  assert.equal(criterion.requirementKey, 'RF-8');
  assert.equal(facts.find(item => item.kind === 'ROLE').text, 'Lector');

  const openapi = Buffer.from(JSON.stringify({
    openapi: '3.0.0',
    paths: { '/saldo': { get: { responses: { 200: { description: 'Respuesta de saldo.' } } } } },
  }));
  const operations = await analyzer.extract({ versionId: 'api', blocks: await parseDocument('JSON', openapi) });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].kind, 'SCENARIO');
  assert.match(operations[0].text, /^GET \/saldo/);
  assert.equal(operations[0].source.locator, '#/paths/~1saldo/get');
  assert.equal(operations[0].pendingConfirmation, true);
});

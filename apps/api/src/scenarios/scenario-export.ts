// Exportación de un conjunto de escenarios como "set de pruebas" en PDF o
// Excel. PDF usa pdfkit (streaming a Buffer con chunks) y mantiene una
// portada + una página por escenario con tabla de pasos. Excel usa exceljs
// con tres hojas: Resumen, Escenarios (1 fila por escenario) y Pasos (1 fila
// por paso, cruzable con el escenario por su id).
//
// Ambas exportaciones omiten datos sensibles de pasos (passwords, tokens,
// PII) basándose en isSensitiveScenarioStep heurística reutilizada del cliente.

import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

type Step = { ordinal: number; action: string; data: string | null; expected: string | null };

export type ExportScenario = {
  id: string;
  title: string;
  tags: string[];
  expectedResult: string | null;
  requirement: { externalKey: string | null; title: string | null } | null;
  steps: Step[];
};

// Oculta el `data` cuando parece contener un secreto (password, token, auth,
// email, nombre completo). Replica la heurística del front para que el
// servidor no filtre lo que la UI oculta.
const SENSITIVE = /password|contraseña|token|auth|secret|cvv|card|tarjeta|email|correo|ssn|dni|nombre completo/i;
function maskedData(step: Step): string {
  if (!step.data) return '';
  if (SENSITIVE.test(step.action) || SENSITIVE.test(step.data)) return '•••';
  return step.data;
}

// ─── PDF ─────────────────────────────────────────────────────────────

export function buildTestSetPdf(projectName: string, scenarios: ExportScenario[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
      Title: 'Set de pruebas · ' + projectName,
      Author: 'AutoQA',
      CreationDate: new Date(),
    }});
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Portada
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#1a1a1a').text('Set de pruebas', { align: 'left' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(16).fillColor('#6a6a6a').text(projectName);
    doc.moveDown(0.6);
    doc.fontSize(10).fillColor('#6a6a6a').text('Generado: ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
    doc.text('Total escenarios: ' + scenarios.length);
    doc.text('Total pasos: ' + scenarios.reduce((s, x) => s + x.steps.length, 0));
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e3e3e3').stroke();
    doc.moveDown(1);

    // Índice
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a1a1a').text('Índice');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#1a1a1a');
    for (const [i, s] of scenarios.entries()) {
      doc.text((i + 1).toString().padStart(2, ' ') + '. ' + s.title, { continued: false });
    }

    // Un escenario por página
    for (const [i, s] of scenarios.entries()) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#1a1a1a').text(`${i + 1}. ${s.title}`);
      doc.font('Helvetica').fontSize(9).fillColor('#6a6a6a').text('ID: ' + s.id.slice(0, 8) + ' · ' + s.id);
      doc.moveDown(0.5);

      // Metadatos
      if (s.requirement) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text('Requisito: ', { continued: true });
        doc.font('Helvetica').fillColor('#333').text([s.requirement.externalKey, s.requirement.title].filter(Boolean).join(' — '));
      }
      if (s.tags.length) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text('Etiquetas: ', { continued: true });
        doc.font('Helvetica').fillColor('#333').text(s.tags.join(', '));
      }
      doc.moveDown(0.5);

      // Tabla de pasos
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a1a').text('Pasos');
      doc.moveDown(0.2);
      const colX = [50, 72, 260, 400];
      const colW = [22, 188, 140, 145];
      const headerY = doc.y;
      doc.rect(50, headerY, 495, 18).fillAndStroke('#f5f5f5', '#e3e3e3');
      doc.fillColor('#6a6a6a').font('Helvetica-Bold').fontSize(9);
      doc.text('#', colX[0] + 4, headerY + 5, { width: colW[0] });
      doc.text('Acción', colX[1] + 4, headerY + 5, { width: colW[1] });
      doc.text('Dato', colX[2] + 4, headerY + 5, { width: colW[2] });
      doc.text('Resultado esperado', colX[3] + 4, headerY + 5, { width: colW[3] });
      doc.y = headerY + 22;

      for (const step of s.steps) {
        const yStart = doc.y;
        const action = step.action;
        const data = maskedData(step);
        const expected = step.expected ?? '';
        const h = Math.max(
          doc.heightOfString(action, { width: colW[1] - 8 }),
          doc.heightOfString(data || '—', { width: colW[2] - 8 }),
          doc.heightOfString(expected || '—', { width: colW[3] - 8 }),
          16,
        );
        // Salto de página si no cabe
        if (yStart + h + 8 > doc.page.height - 50) {
          doc.addPage();
        }
        const rowY = doc.y;
        doc.rect(50, rowY, 495, h + 8).strokeColor('#eeeeee').stroke();
        doc.fillColor('#1a1a1a').font('Helvetica').fontSize(9);
        doc.text(step.ordinal.toString(), colX[0] + 4, rowY + 4, { width: colW[0] });
        doc.text(action, colX[1] + 4, rowY + 4, { width: colW[1] - 8 });
        doc.text(data || '—', colX[2] + 4, rowY + 4, { width: colW[2] - 8 });
        doc.text(expected || '—', colX[3] + 4, rowY + 4, { width: colW[3] - 8 });
        doc.y = rowY + h + 8;
      }

      // Resultado esperado final
      if (s.expectedResult) {
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text('Resultado esperado del caso:');
        doc.font('Helvetica').fillColor('#333').fontSize(10).text(s.expectedResult, { width: 495 });
      }
    }

    doc.end();
  });
}

// ─── Excel ───────────────────────────────────────────────────────────

export async function buildTestSetXlsx(projectName: string, scenarios: ExportScenario[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AutoQA';
  wb.created = new Date();
  wb.title = 'Set de pruebas · ' + projectName;

  const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF5F5F5' } };
  const headerFont = { bold: true, size: 11, color: { argb: 'FF333333' } };
  const border = { style: 'thin' as const, color: { argb: 'FFE3E3E3' } };
  const borderAll = { top: border, left: border, bottom: border, right: border };

  // Hoja 1: Resumen
  const summary = wb.addWorksheet('Resumen');
  summary.columns = [{ header: 'Dato', key: 'k', width: 24 }, { header: 'Valor', key: 'v', width: 60 }];
  summary.getRow(1).font = headerFont;
  summary.getRow(1).fill = headerFill;
  summary.addRow({ k: 'Proyecto', v: projectName });
  summary.addRow({ k: 'Generado', v: new Date().toISOString().slice(0, 16).replace('T', ' ') });
  summary.addRow({ k: 'Total escenarios', v: scenarios.length });
  summary.addRow({ k: 'Total pasos', v: scenarios.reduce((s, x) => s + x.steps.length, 0) });
  summary.addRow({ k: 'Escenarios con requisito', v: scenarios.filter(s => s.requirement).length });
  summary.eachRow(row => row.eachCell(cell => cell.border = borderAll));

  // Hoja 2: Escenarios
  const sh = wb.addWorksheet('Escenarios');
  sh.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Título', key: 'title', width: 50 },
    { header: 'Requisito', key: 'req', width: 30 },
    { header: 'Etiquetas', key: 'tags', width: 30 },
    { header: 'Pasos', key: 'steps', width: 8 },
    { header: 'Resultado esperado', key: 'expected', width: 60 },
  ];
  sh.getRow(1).font = headerFont;
  sh.getRow(1).fill = headerFill;
  for (const s of scenarios) {
    sh.addRow({
      id: s.id.slice(0, 8),
      title: s.title,
      req: s.requirement ? [s.requirement.externalKey, s.requirement.title].filter(Boolean).join(' — ') : '',
      tags: s.tags.join(', '),
      steps: s.steps.length,
      expected: s.expectedResult ?? '',
    });
  }
  sh.eachRow(row => row.eachCell(cell => { cell.border = borderAll; cell.alignment = { vertical: 'top', wrapText: true }; }));

  // Hoja 3: Pasos (1 fila por paso, cruzable con Escenario.ID)
  const ps = wb.addWorksheet('Pasos');
  ps.columns = [
    { header: 'Escenario ID', key: 'scid', width: 12 },
    { header: 'Escenario', key: 'title', width: 45 },
    { header: '#', key: 'ord', width: 5 },
    { header: 'Acción', key: 'action', width: 40 },
    { header: 'Dato', key: 'data', width: 28 },
    { header: 'Resultado esperado', key: 'expected', width: 40 },
  ];
  ps.getRow(1).font = headerFont;
  ps.getRow(1).fill = headerFill;
  for (const s of scenarios) {
    for (const step of s.steps) {
      ps.addRow({
        scid: s.id.slice(0, 8),
        title: s.title,
        ord: step.ordinal,
        action: step.action,
        data: maskedData(step),
        expected: step.expected ?? '',
      });
    }
  }
  ps.eachRow(row => row.eachCell(cell => { cell.border = borderAll; cell.alignment = { vertical: 'top', wrapText: true }; }));

  const result = await wb.xlsx.writeBuffer();
  return Buffer.from(result);
}

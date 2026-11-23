// Agente "convertir archivos": pasa PDF/DOCX/XLSX/TXT/MD a Markdown
// usando librerías (sin IA). El llamador decide si invoca el fallback IA
// cuando la extracción sale vacía o rota. No persiste; devuelve strings.

import type { SourceBlock } from '../documents/document-files';

export function sourceBlocksToMarkdown(blocks: SourceBlock[]): string {
  return blocks.map(block => sanitize(block.text).trim()).filter(Boolean).join('\n\n');
}

export type ConvertedDocument = {
  filename: string;
  mime: string;
  markdown: string;
  sourceBytes: number;
  warnings: string[];
};

export type ConvertInput = {
  filename: string;
  bytes: Buffer;
};

function ext(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return (match?.[1] ?? '').toLowerCase();
}

function sanitize(text: string): string {
  // Quita caracteres de control que no sean tab/newline/CR.
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export async function convertDocument(input: ConvertInput): Promise<ConvertedDocument> {
  const warnings: string[] = [];
  const extension = ext(input.filename);
  let markdown = '';
  let mime = 'application/octet-stream';

  try {
    if (extension === 'md' || extension === 'markdown') {
      markdown = sanitize(input.bytes.toString('utf8'));
      mime = 'text/markdown';
    } else if (extension === 'txt') {
      markdown = sanitize(input.bytes.toString('utf8'));
      mime = 'text/plain';
    } else if (extension === 'pdf') {
      // import dinámico para no cargar la lib si el worker nunca ve PDFs.
      const pdfParseMod = (await import('pdf-parse')) as unknown as {
        default: (data: Buffer) => Promise<{ text?: string }>;
      };
      const parsed = await pdfParseMod.default(input.bytes);
      markdown = sanitize(parsed.text ?? '');
      mime = 'application/pdf';
      if (markdown.trim().length === 0) warnings.push('pdf-sin-texto-extraible');
    } else if (extension === 'docx') {
      // Mammoth expone convertToMarkdown aunque los @types no lo declaren.
      const mammoth = await import('mammoth') as unknown as {
        convertToMarkdown: (input: { buffer: Buffer }) => Promise<{
          value: string; messages?: Array<{ type: string; message?: string }>;
        }>;
      };
      const { value, messages } = await mammoth.convertToMarkdown({ buffer: input.bytes });
      markdown = sanitize(value);
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      for (const msg of messages ?? []) {
        if (msg.type === 'error' || msg.type === 'warning') warnings.push('docx-' + msg.type);
      }
    } else if (extension === 'xlsx' || extension === 'xls') {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      // exceljs espera Buffer ambiguo; casting explícito porque Node 22
      // marca Buffer<ArrayBufferLike> y la lib usa Buffer<ArrayBuffer>.
      await workbook.xlsx.load(input.bytes as unknown as ArrayBuffer);
      const parts: string[] = [];
      workbook.eachSheet(sheet => {
        parts.push('## ' + (sheet.name || 'Hoja'));
        sheet.eachRow(row => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: false }, cell => {
            const v = cell.value;
            cells.push(typeof v === 'object' && v !== null && 'text' in v ? String((v as { text: unknown }).text) : String(v ?? ''));
          });
          if (cells.length) parts.push('- ' + cells.join(' | '));
        });
        parts.push('');
      });
      markdown = sanitize(parts.join('\n'));
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      warnings.push('formato-no-soportado-' + extension);
      // Intento oportunista: ¿será texto plano con otra extensión?
      const asText = input.bytes.toString('utf8');
      if (/^[\x20-\x7E\s]*$/.test(asText.slice(0, 200))) {
        markdown = sanitize(asText);
      }
    }
  } catch (error) {
    warnings.push('conversion-fallida-' + (error instanceof Error ? error.message : String(error)).slice(0, 80));
  }

  // Trim agresivo: el agente revisor no necesita 50MB de PDF.
  if (markdown.length > 60000) {
    warnings.push('truncado-a-60k-chars');
    markdown = markdown.slice(0, 60000) + '\n\n[... truncado]';
  }

  return {
    filename: input.filename,
    mime,
    markdown,
    sourceBytes: input.bytes.length,
    warnings,
  };
}

// Determina si una conversión salió "vacía" y vale la pena intentar IA.
export function needsAiFallback(converted: ConvertedDocument): boolean {
  return converted.markdown.trim().length < 80
    || converted.warnings.some(w => w.startsWith('conversion-fallida'))
    || converted.warnings.includes('pdf-sin-texto-extraible');
}

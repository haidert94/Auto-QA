import { parse as parseCsv } from 'csv-parse/sync';
import { parentPort, workerData } from 'node:worker_threads';
import { parseDocument as readYaml } from 'yaml';
import { readOffice } from './office-reader';
import type { SourceBlock } from './document-files';
import type { DocumentFormat } from '@prisma/client';

const MAX_BLOCKS = 4000;
const MAX_TEXT = 300_000;

export function decodeText(data: Buffer) {
  const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le'
    : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8';
  const text = new TextDecoder(encoding, { fatal: true }).decode(data);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new Error();
  return text;
}

function lines(text: string, prefix = ''): SourceBlock[] {
  return text.split(/\r\n|\n|\r/).flatMap((line, index) => line.trim()
    ? [{ text: line.trim(), locator: prefix + 'línea ' + (index + 1) }] : []);
}

export function tableRow(row: string[], headers: string[], locator: string): SourceBlock {
  const fields = Object.fromEntries(headers.flatMap((header, index) => header ? [[header, row[index] ?? '']] : []));
  return { text: row.filter(Boolean).join(' | '), locator, fields };
}

function structured(value: unknown): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let visited = 0;
  function walk(node: unknown, path: string, depth: number, requirementKey?: string) {
    if (++visited > 12000 || depth > 40) throw new Error();
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, path + '/' + index, depth + 1, requirementKey));
    } else if (node && typeof node === 'object') {
      const entries = Object.entries(node);
      const fields = Object.fromEntries(entries.filter(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry))
        .map(([key, entry]) => [key, String(entry)]));
      const text = Object.values(fields).filter(Boolean).join(' | ');
      const inherited = path.match(/\/(?:acceptanceCriteria|acceptance_criteria|criteriosDeAceptacion|criterios)(?:\/|$)/i)
        ? requirementKey : undefined;
      if (inherited && fields.requirementId === undefined && fields.requisito === undefined && fields.requirement === undefined) {
        fields.requirementId = inherited;
      }
      if (text || /^\/paths\/[^/]+\/(?:get|post|put|patch|delete|head|options|trace)$/i.test(path)) {
        blocks.push({ text: text || 'Operación declarada', locator: '#' + path, fields });
      }
      for (const [key, entry] of entries) {
        if (entry && typeof entry === 'object') walk(entry, path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'), depth + 1, fields.id ?? fields.clave ?? requirementKey);
      }
    } else if (typeof node === 'string' && node.trim()) {
      blocks.push({
        text: node.trim(), locator: '#' + path,
        fields: requirementKey ? { text: node.trim(), requirementId: requirementKey } : undefined,
      });
    }
  }
  walk(value, '', 0);
  return blocks;
}

async function pdf(data: Buffer): Promise<SourceBlock[]> {
  if (data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: Uint8Array.from(data), stopAtErrors: true, disableFontFace: true,
    useSystemFonts: false, useWasm: false, verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (!document.numPages || document.numPages > 100) throw new Error();
    const blocks: SourceBlock[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const { items } = await page.getTextContent();
      let line = '';
      const pageLines: string[] = [];
      for (const item of items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) { pageLines.push(line); line = ''; }
      }
      pageLines.push(line);
      blocks.push(...lines(pageLines.join('\n'), 'página ' + index + ', '));
      page.cleanup();
      if (blocks.length > MAX_BLOCKS) throw new Error();
    }
    return blocks;
  } finally {
    await task.destroy();
  }
}

async function extract(format: DocumentFormat, data: Buffer): Promise<SourceBlock[]> {
  if (format === 'PDF') return pdf(data);
  if (format === 'DOCX' || format === 'XLSX') return readOffice(format, data, decodeText, tableRow);
  const text = decodeText(data);
  if (text.length > MAX_TEXT) throw new Error();
  if (format === 'JSON') return structured(JSON.parse(text));
  if (format === 'YAML' || format === 'YML') {
    const document = readYaml(text, { schema: 'core', uniqueKeys: true });
    if (document.errors.length || document.warnings.length || !document.contents) throw new Error();
    return structured(document.toJS({ maxAliasCount: 0 }));
  }
  if (format === 'CSV') {
    for (const delimiter of [',', ';', '\t']) {
      try {
        const rows = parseCsv(text, {
          delimiter, info: true, skip_empty_lines: true, max_record_size: 8192,
        }) as unknown as { record: string[]; info: { lines: number } }[];
        if (rows[0]?.record.length >= 2 && rows.length > 1) {
          const headers = rows[0].record.map(cell => cell.trim());
          if (new Set(headers).size !== headers.length) throw new Error();
          return rows.slice(1).map(({ record, info }) => tableRow(record, headers, 'fila que termina en línea ' + info.lines));
        }
      } catch { /* Try the next supported delimiter. */ }
    }
    throw new Error();
  }
  return lines(text);
}

if (parentPort) {
  const output = parentPort;
  const { format, data } = workerData as { format: DocumentFormat; data: Uint8Array };
  void extract(format, Buffer.from(data)).then(blocks => {
    const total = blocks.reduce((count, block) => count + block.text.length + block.locator.length, 0);
    if (blocks.length > MAX_BLOCKS || total > MAX_TEXT) throw new Error();
    if (blocks.some(block => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(block.text + block.locator))) {
      throw new Error();
    }
    output.postMessage(blocks);
  }).catch(() => output.postMessage(null));
}

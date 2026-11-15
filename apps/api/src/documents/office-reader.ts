import { posix } from 'node:path';
import { SaxesParser } from 'saxes';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import type { SourceBlock } from './document-files';

const MAX_EXPANDED_BYTES = 24 * 1024 * 1024;

type XmlNode = { name: string; attrs: Record<string, string>; content: (string | XmlNode)[] };

function xml(source: string): XmlNode {
  const root: XmlNode = { name: '', attrs: {}, content: [] };
  const stack = [root];
  const parser = new SaxesParser();
  let nodes = 0;
  parser.on('doctype', () => { throw new Error(); });
  parser.on('opentag', tag => {
    if (++nodes > 100_000 || stack.length > 70) throw new Error();
    const child = { name: tag.name.split(':').at(-1)!, attrs: tag.attributes, content: [] };
    stack.at(-1)!.content.push(child);
    stack.push(child);
  });
  parser.on('text', text => stack.at(-1)!.content.push(text));
  parser.on('cdata', text => stack.at(-1)!.content.push(text));
  parser.on('closetag', () => { stack.pop(); });
  parser.write(source).close();
  const document = root.content.find((node): node is XmlNode => typeof node !== 'string');
  if (!document) throw new Error();
  return document;
}

function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.content.flatMap(child => typeof child === 'string' ? []
    : child.name === name ? [child] : descendants(child, name));
}

function text(node?: XmlNode): string {
  return node?.content.map(child => typeof child === 'string' ? child : text(child)).join('') ?? '';
}

function xmlParts(data: Buffer, format: 'DOCX' | 'XLSX'): Promise<Map<string, Buffer>> {
  const wanted = format === 'DOCX'
    ? /^(?:\[Content_Types\]\.xml|word\/document\.xml)$/ 
    : /^(?:\[Content_Types\]\.xml|xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml))$/;
  return new Promise((resolve, reject) => {
    fromBuffer(data, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      const fail = () => { zip.close(); reject(new Error()); };
      const parts = new Map<string, Buffer>();
      const names = new Set<string>();
      let expanded = 0;
      zip.once('error', fail);
      zip.once('end', () => resolve(parts));
      if (zip.entryCount > 300) { fail(); return; }
      zip.on('entry', (entry: Entry) => {
        expanded += entry.uncompressedSize;
        if (expanded > MAX_EXPANDED_BYTES || names.has(entry.fileName) ||
            /\bvbaProject\.bin$/i.test(entry.fileName) || (entry.generalPurposeBitFlag & 1)) {
          fail();
          return;
        }
        names.add(entry.fileName);
        if (!wanted.test(entry.fileName)) { zip.readEntry(); return; }
        void part(zip, entry).then(bytes => {
          parts.set(entry.fileName, bytes);
          zip.readEntry();
        }, fail);
      });
      zip.readEntry();
    });
  });
}

function part(zip: ZipFile, entry: Entry) {
  return new Promise<Buffer>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) { reject(error); return; }
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

export async function readOffice(
  format: 'DOCX' | 'XLSX',
  data: Buffer,
  decode: (value: Buffer) => string,
  rowBlock: (row: string[], headers: string[], locator: string) => SourceBlock,
): Promise<SourceBlock[]> {
  if (data.readUInt32LE(0) !== 0x04034b50) throw new Error();
  const parts = await xmlParts(data, format);
  function read(path: string): XmlNode {
    const bytes = parts.get(path);
    if (!bytes) throw new Error();
    return xml(decode(bytes));
  }
  const mainPath = format === 'DOCX' ? 'word/document.xml' : 'xl/workbook.xml';
  const mainType = format === 'DOCX'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  const contentTypes = read('[Content_Types].xml');
  if (contentTypes.name !== 'Types' || !descendants(contentTypes, 'Override')
    .some(node => node.attrs.PartName === '/' + mainPath && node.attrs.ContentType === mainType)) throw new Error();

  const main = read(mainPath);
  if (format === 'DOCX') {
    if (main.name !== 'document' || !descendants(main, 'body').length) throw new Error();
    return descendants(main, 'p').flatMap((paragraph, index) => {
      const content = descendants(paragraph, 't').map(text).join('').trim();
      return content ? [{ text: content, locator: 'párrafo ' + (index + 1) }] : [];
    });
  }

  if (main.name !== 'workbook') throw new Error();
  const relations = descendants(read('xl/_rels/workbook.xml.rels'), 'Relationship');
  const shared = parts.has('xl/sharedStrings.xml')
    ? descendants(read('xl/sharedStrings.xml'), 'si').map(item => descendants(item, 't').map(text).join('')) : [];
  const sheets = descendants(main, 'sheet');
  if (!sheets.length || sheets.length > 30) throw new Error();
  const blocks: SourceBlock[] = [];
  for (const sheet of sheets) {
    const relation = relations.find(item => item.attrs.Id === sheet.attrs['r:id']);
    const target = relation?.attrs.Target;
    if (!target || relation.attrs.TargetMode === 'External' || !relation.attrs.Type?.endsWith('/worksheet')) throw new Error();
    const path = target.startsWith('/') ? target.slice(1) : posix.join('xl', target);
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path)) throw new Error();
    const page = read(path);
    if (page.name !== 'worksheet') throw new Error();
    let headers: string[] | undefined;
    descendants(page, 'row').forEach((row, index) => {
      const cells: string[] = [];
      descendants(row, 'c').forEach((cell, position) => {
        const column = cell.attrs.r?.match(/^([A-Z]{1,3})\d+$/)?.[1];
        const offset = column ? [...column].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1 : position;
        if (offset >= 100) throw new Error();
        const cached = text(descendants(cell, 'v')[0]);
        cells[offset] = cell.attrs.t === 's' ? shared[Number(cached)] ?? ''
          : cell.attrs.t === 'inlineStr' ? descendants(cell, 't').map(text).join('') : cached;
      });
      if (!cells.some(Boolean)) return;
      const locator = 'hoja ' + (sheet.attrs.name || '') + ', fila ' + (row.attrs.r ?? index + 1);
      if (!headers) {
        headers = cells.map(cell => cell.trim());
        cells.forEach((cell, offset) => {
          if (cell.trim()) blocks.push({ text: cell.trim(), locator: locator + ', columna ' + (offset + 1) });
        });
        return;
      }
      blocks.push(rowBlock(cells, headers, locator));
    });
  }
  return blocks;
}

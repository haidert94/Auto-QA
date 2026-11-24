import { isRequirement, type Finding } from './document-analysis';
import type { SourceBlock } from './document-files';

const moduleLabel = /^(?:m[oó]dulo|module)\s*:\s*(.+)$/iu;

function fieldLabel(text: string) {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFD').replace(/\p{Mark}/gu, '')
    .toLowerCase().trim().replace(/[_\s-]+/g, ' ');
}

function matchedText(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function attachDeclaredModules(findings: Finding[], blocks: SourceBlock[]) {
  let section: { depth: number; module: string } | undefined;
  let nextModule: string | undefined;
  let inCodeBlock = false;
  const sources: Array<{ locator: string; text: string; module?: string }> = [];
  for (const block of blocks) {
    const raw = block.text.trim();
    if (/^(\x60{3,}|~{3,})/.test(raw)) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    const heading = /^(#{1,6})\s+(.+)$/u.exec(raw);
    const line = (heading?.[2] ?? raw).replace(/^[-*•]\s+/u, '');
    if (heading && section && heading[1].length <= section.depth) section = undefined;
    const standalone = !block.fields && moduleLabel.exec(line);
    if (standalone) {
      if (heading) section = { depth: heading[1].length, module: standalone[1] };
      else nextModule = standalone[1];
      continue;
    }
    const fields = new Map(Object.entries(block.fields ?? {}).map(([name, value]) => [fieldLabel(name), value.trim()]));
    const code = fields.get('codigo de modulo') || fields.get('module code');
    const validCode = code && /^[\p{L}][\p{L}\p{N}]{0,7}$/u.test(code);
    const explicit = fields.get('modulo') ?? fields.get('module')
      ?? line.split(/\s+[|;]\s+/u).slice(1).map(part => moduleLabel.exec(part)?.[1]).find(Boolean);
    const module = (validCode ? '[' + code + ']' : explicit ?? nextModule ?? section?.module)?.trim().slice(0, 120);
    sources.push({ locator: block.locator, text: matchedText(raw), module: module || undefined });
    nextModule = undefined;
  }

  const byLocator = new Map(sources.map(source => [source.locator, source]));
  for (const finding of findings) {
    if (!isRequirement(finding.kind)) continue;
    const source = byLocator.get(finding.source.locator);
    if (source) {
      finding.module = source.module;
      continue;
    }
    // The AI analyzer returns document-level locators. A single module must
    // be supported by the actual rows containing the approved wording.
    const excerpt = matchedText(finding.text).slice(0, 120);
    if (excerpt.length < 10) continue;
    const key = finding.key?.toLowerCase();
    const matches = sources.filter(row => row.text.includes(excerpt));
    const keyed = key ? matches.filter(row => row.text.split(/[^\p{L}\p{N}_-]+/u).includes(key)) : [];
    const modules = new Set((keyed.length ? keyed : matches).map(row => row.module));
    if (modules.size === 1) finding.module = modules.values().next().value;
  }
}

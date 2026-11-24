import { DocumentType, FindingKind } from '@prisma/client';
import type { SourceBlock } from './document-files';

export type Source = { versionId: string; locator: string };
export type Finding = {
  kind: FindingKind;
  text: string;
  source: Source;
  relatedSource?: Source;
  key?: string;
  requirementKey?: string;
  module?: string;
  pendingConfirmation: boolean;
  // Explicación corta del motivo cuando pendingConfirmation es true. La IA
  // la devuelve; el analizador por reglas la deja undefined.
  pendingReason?: string;
};
export type Evidence = {
  versionId: string;
  blocks: SourceBlock[];
  // Representación del documento ya pasada a Markdown por
  // document-converter. Se usa en el prompt del analyzer con IA para que
  // el modelo trabaje sobre texto continuo (historias de usuario,
  // listas, tablas) en lugar de blocks con locators. Opcional porque el
  // analizador por reglas sigue consumiendo los blocks.
  markdown?: string;
  filename?: string;
};

// Contexto que el router de IA necesita para enforcement de budget y
// gating por plan. El analizador rule-based lo ignora.
export type AnalyzeContext = {
  organizationId: string | null;
  projectId: string | null;
  runKey: string | null;
};

// A provider proposes candidates against supplied evidence. A future adapter must validate
// every proposed excerpt and locator against that evidence before returning findings.
export interface DocumentAnalysisProvider {
  extract(evidence: Evidence, context: AnalyzeContext): Promise<Finding[]>;
}

export const REQUIREMENT_KINDS: FindingKind[] = ['USER_STORY', 'REQUIREMENT', 'FUNCTIONAL', 'NON_FUNCTIONAL'];

export function isRequirement(kind: FindingKind) {
  return REQUIREMENT_KINDS.includes(kind);
}

function normalized(text: string) {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase().trim().replace(/[_\s-]+/g, ' ');
}

const categories: Record<string, FindingKind> = {
  'user stories': 'USER_STORY', 'requirements': 'REQUIREMENT',
  'business rules': 'BUSINESS_RULE', 'permissions': 'PERMISSION', 'test scenarios': 'SCENARIO',
  'scenarios': 'SCENARIO', 'criterios': 'ACCEPTANCE_CRITERION',
  'functional': 'FUNCTIONAL', 'non functional': 'NON_FUNCTIONAL',
  'historia de usuario': 'USER_STORY', 'historias de usuario': 'USER_STORY', 'user story': 'USER_STORY',
  'requisito funcional': 'FUNCTIONAL', 'requisitos funcionales': 'FUNCTIONAL',
  'functional requirement': 'FUNCTIONAL', 'functional requirements': 'FUNCTIONAL',
  'requisito no funcional': 'NON_FUNCTIONAL', 'requisitos no funcionales': 'NON_FUNCTIONAL',
  'non functional requirement': 'NON_FUNCTIONAL', 'non functional requirements': 'NON_FUNCTIONAL',
  'requisito': 'REQUIREMENT', 'requisitos': 'REQUIREMENT', 'requirement': 'REQUIREMENT',
  'criterio de aceptacion': 'ACCEPTANCE_CRITERION', 'criterios de aceptacion': 'ACCEPTANCE_CRITERION',
  'acceptance criterion': 'ACCEPTANCE_CRITERION', 'acceptance criteria': 'ACCEPTANCE_CRITERION',
  'regla de negocio': 'BUSINESS_RULE', 'reglas de negocio': 'BUSINESS_RULE', 'business rule': 'BUSINESS_RULE',
  'rol': 'ROLE', 'roles': 'ROLE', 'role': 'ROLE',
  'permiso': 'PERMISSION', 'permisos': 'PERMISSION', 'permission': 'PERMISSION',
  'escenario': 'SCENARIO', 'escenarios de prueba': 'SCENARIO', 'test scenario': 'SCENARIO', 'escenario de prueba': 'SCENARIO',
};

function category(text: string) {
  const label = normalized(text).replace(/:$/, '');
  return Object.hasOwn(categories, label) ? categories[label] : undefined;
}

function openApi(blocks: SourceBlock[]) {
  return blocks.some(block => block.locator === '#' && Object.keys(block.fields ?? {}).some(key => /^(openapi|swagger)$/i.test(key)));
}

const keyedLine = /^((?:RNF|FR|NFR|RF|REQ|HU|US|CA|AC|RN|BR)[- ]\d+(?:[.-]\d+)*)\s*[:–-]\s*(.+)$/iu;
const criterionLink = /^\[((?:RNF|FR|NFR|RF|REQ|HU|US)[- ]\d+(?:[.-]\d+)*)\]\s*(.+)$/iu;

function normalizeKey(value?: string) {
  return value?.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 80);
}

function keyKind(key: string): FindingKind | undefined {
  switch (key.split('-')[0]) {
    case 'RF': case 'FR': return 'FUNCTIONAL';
    case 'RNF': case 'NFR': return 'NON_FUNCTIONAL';
    case 'REQ': return 'REQUIREMENT';
    case 'HU': case 'US': return 'USER_STORY';
    case 'CA': case 'AC': return 'ACCEPTANCE_CRITERION';
    case 'RN': case 'BR': return 'BUSINESS_RULE';
    default: return undefined;
  }
}

function fieldMap(fields: Record<string, string> = {}) {
  return new Map(Object.entries(fields).map(([key, value]) => [normalized(key), value.trim()]));
}

export class RuleBasedDocumentAnalyzer implements DocumentAnalysisProvider {
  // El contexto se ignora acá: el analizador por reglas no consume budget ni
  // pasa por el router. Se recibe para cumplir la interfaz.
  async extract(evidence: Evidence, _context?: AnalyzeContext): Promise<Finding[]> {
    void _context;
    const findings: Finding[] = [];
    const api = openApi(evidence.blocks);
    let inCodeBlock = false;
    let section: FindingKind | undefined;
    let depth = 0;
    let currentKey: string | undefined;
    for (const block of evidence.blocks) {
      const raw = block.text.trim();
      if (/^(\x60{3,}|~{3,})/.test(raw)) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) continue;
      const heading = raw.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const kind = category(heading[2]);
        if (kind) {
          section = kind;
          depth = heading[1].length;
          if (kind !== 'ACCEPTANCE_CRITERION') currentKey = undefined;
          continue;
        }
        if (heading[1].length <= depth) {
          section = undefined;
          currentKey = undefined;
        }
      }
      const line = (heading?.[2] ?? raw).replace(/^(\s*[-*•]\s+|\s*\d+\.\s+)+/, '').trim();
      const typedHeading = category(line);
      if (typedHeading) {
        section = typedHeading;
        if (typedHeading !== 'ACCEPTANCE_CRITERION') currentKey = undefined;
        continue;
      }

      const fields = fieldMap(block.fields);
      const fieldType = fields.get('tipo') ?? fields.get('type') ?? fields.get('kind');
      const fieldText = fields.get('texto') ?? fields.get('text') ?? fields.get('descripcion')
        ?? fields.get('description') ?? fields.get('titulo') ?? fields.get('title');
      const structuredKind = fieldType && (category(fieldType) ?? keyKind(fieldType.toUpperCase()));
      const keyed = line.match(keyedLine);
      const key = normalizeKey(fields.get('id') ?? fields.get('clave') ?? keyed?.[1]);
      const label = line.match(/^([^:]{1,55}):\s*(.+)$/u);
      const labeled = label && category(label[1]);
      const path = block.locator.startsWith('#/') ? block.locator.slice(2).split('/') : [];
      const pathType = [...path].reverse().map(category).find(Boolean);
      const operation = api && path[0] === 'paths' && path.length === 3 &&
        /^(?:get|post|put|patch|delete|head|options|trace)$/i.test(path[2]);
      const candidate = structuredKind || (key && keyKind(key)) || labeled || pathType || section;
      const inferred = !candidate && !block.fields && /\b(como\s+\S.+\bquiero|as an?\b.+\b(?:i want|i need))\b/iu.test(line)
        ? 'USER_STORY'
        : !candidate && /\b(debe(?:n|rá|rán)?|shall|must)\b/iu.test(line) ? 'REQUIREMENT' : undefined;
      const kind = candidate || inferred;
      if (operation && !candidate) {
        findings.push({
          kind: 'SCENARIO',
          text: (path[2].toUpperCase() + ' ' + path[1].replace(/~1/g, '/').replace(/~0/g, '~') +
            ' · ' + (fields.get('summary') ?? fields.get('operation id') ?? 'Operación declarada')).slice(0, 1600),
          source: { versionId: evidence.versionId, locator: block.locator.slice(0, 512) },
          pendingConfirmation: true,
        });
        if (findings.length > 300) throw new Error('Demasiados elementos extraídos.');
        continue;
      }
      if (!kind) continue;

      let text = ((structuredKind || pathType || (key && fields.size)) ? fieldText ?? raw : keyed?.[2] ?? (labeled ? label?.[2] : line))?.trim();
      if (!text || /^[-|:\s]+$/.test(text)) continue;
      const link = kind === 'ACCEPTANCE_CRITERION' ? text.match(criterionLink) : null;
      if (link) text = link[2];
      const reference = normalizeKey(fields.get('requisito') ?? fields.get('requirement')
        ?? fields.get('requirement id') ?? fields.get('requirementid') ?? link?.[1]);
      if (isRequirement(kind)) currentKey = key;
      findings.push({
        kind,
        text: text.slice(0, 1600),
        key,
        requirementKey: kind === 'ACCEPTANCE_CRITERION' ? reference ?? currentKey : undefined,
        pendingConfirmation: !!inferred || text.length > 1600 || (kind === 'ACCEPTANCE_CRITERION' && !reference && !!currentKey),
        source: { versionId: evidence.versionId, locator: block.locator.slice(0, 512) },
      });
      if (findings.length > 300) throw new Error('Demasiados elementos extraídos.');
    }
    return findings;
  }
}

export function classifyDocument(findings: Finding[], blocks: SourceBlock[]): DocumentType {
  if (openApi(blocks)) {
    return 'API';
  }
  const types: [DocumentType, FindingKind[]][] = [
    ['USER_STORY', ['USER_STORY']], ['REQUIREMENTS', ['FUNCTIONAL', 'NON_FUNCTIONAL', 'REQUIREMENT']],
    ['ACCEPTANCE_CRITERIA', ['ACCEPTANCE_CRITERION']], ['BUSINESS_RULE', ['BUSINESS_RULE']], ['FLOW', ['SCENARIO']],
  ];
  const counts = types.map(([type, kinds]) => ({
    type, count: findings.filter(finding => kinds.includes(finding.kind)).length,
  })).sort((a, b) => b.count - a.count);
  return counts[0].count ? counts[0].type : 'OTHER';
}

export function analyzeFindings(facts: Finding[]) {
  const issues: Finding[] = [];
  const keyed = new Map<string, Finding>();
  const criteria = new Map<string, Finding>();
  const uncertain = new Set<Finding>();
  for (const fact of facts) {
    if (fact.kind === 'ACCEPTANCE_CRITERION' && fact.requirementKey && !fact.pendingConfirmation) {
      criteria.set(fact.requirementKey, fact);
    }
    if (!fact.key) continue;
    const index = fact.kind + ':' + fact.key;
    const previous = keyed.get(index);
    if (!previous) { keyed.set(index, fact); continue; }
    if (previous.source.versionId === fact.source.versionId || normalized(previous.text) === normalized(fact.text)) continue;
    uncertain.add(previous);
    uncertain.add(fact);
    if (issues.length < 300) issues.push({
      kind: 'CONTRADICTION', text: 'Posible contradicción: ' + fact.key + ' tiene descripciones distintas.',
      source: fact.source, relatedSource: previous.source, pendingConfirmation: true,
    });
  }

  for (const fact of facts.filter(item => isRequirement(item.kind))) {
    const unclear = /\b(rapido|intuitivo|adecuado|apropiado|facil|eficiente|pronto|cuando sea posible|as needed|fast|user friendly|appropriate)\b/u
      .test(normalized(fact.text)) && !/\b\d+(?:[.,]\d+)?\s*(?:ms|s|segundos?|minutos?|%|horas?)\b/iu.test(fact.text);
    const criterion = fact.key ? criteria.get(fact.key) : undefined;
    if (unclear || !criterion || uncertain.has(fact) || (criterion && uncertain.has(criterion))) {
      fact.pendingConfirmation = true;
      if ((unclear || !criterion) && issues.length < 300) issues.push({
        kind: 'AMBIGUITY',
        text: unclear ? 'El requisito contiene una expresión que necesita una medida o condición verificable.'
          : 'No se encontró un criterio de aceptación explícito asociado a este requisito.',
        source: fact.source, pendingConfirmation: true,
      });
    } else if (issues.length < 300) {
      issues.push({
        kind: 'SCENARIO', text: 'Escenario por confirmar: comprobar el criterio citado para el requisito indicado.',
        source: fact.source, relatedSource: criterion.source, pendingConfirmation: true,
      });
    }
  }
  for (const fact of uncertain) fact.pendingConfirmation = true;
  return [...facts, ...issues];
}

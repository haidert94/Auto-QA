// Extractor de Findings asistido por IA. Despacha via AiRouter con la
// operación "document-analysis": el router elige modelo por operación,
// aplica presupuesto y cascada de fallback. Si la IA no está disponible
// (sin API key, sin capability del plan, respuesta inválida), delega al
// analizador por reglas para no dejar al proyecto sin diagnóstico.
//
// Garantía anti-alucinación: cada finding que el modelo propone se valida
// contra los locators reales presentes en los blocks; lo que no coincide
// se descarta en silencio en lugar de almacenarse.

import { Injectable } from '@nestjs/common';
import { FindingKind } from '@prisma/client';
import { AiRouter } from '../ai/ai-router';
import {
  isRequirement, RuleBasedDocumentAnalyzer, type AnalyzeContext,
  type DocumentAnalysisProvider, type Evidence, type Finding,
} from './document-analysis';

const VALID_KINDS = new Set<FindingKind>([
  'USER_STORY', 'REQUIREMENT', 'FUNCTIONAL', 'NON_FUNCTIONAL',
  'ACCEPTANCE_CRITERION', 'BUSINESS_RULE', 'ROLE', 'PERMISSION', 'SCENARIO',
]);

const SYSTEM_PROMPT = [
  'Eres un analista QA senior. Tu tarea es leer blocks de un documento del cliente y producir findings estructurados.',
  '',
  'Reglas:',
  '- Solo propones findings que están explícitamente en los blocks. Está prohibido inventar texto, páginas o líneas.',
  '- Cada finding referencia el locator exacto de un block del input. Si no puedes dar un locator presente, descarta el candidato.',
  '- "pendingConfirmation" es true cuando el texto admite más de una interpretación razonable o depende de información no declarada.',
  '- Si identificas un requisito con llave visible (HU-1, RF-01, CA-2, REQ-3, etc.), copiala literal en "key".',
  '- Para criterios de aceptación que mencionan una llave superior (por ejemplo "[HU-1]"), colocala en "requirementKey".',
  '- Rendimiento máximo: 80 findings por documento. Si hay más, quédate con los más informativos.',
  '',
  'Responde ÚNICAMENTE un JSON válido en una línea, sin markdown, sin texto antes ni después. Shape exacto:',
  '{"findings":[{"kind":"USER_STORY|REQUIREMENT|FUNCTIONAL|NON_FUNCTIONAL|ACCEPTANCE_CRITERION|BUSINESS_RULE|ROLE|PERMISSION|SCENARIO","text":"...","locator":"...","key":"HU-1","requirementKey":"HU-1","pendingConfirmation":false}]}',
  '',
  'Si no detectas nada reconocible, responde {"findings":[]}.',
].join('\n');

type RawFinding = {
  kind?: unknown;
  text?: unknown;
  locator?: unknown;
  key?: unknown;
  requirementKey?: unknown;
  pendingConfirmation?: unknown;
};

function serializeBlocks(evidence: Evidence): string {
  // Cada línea: locator | texto normalizado. Se truncan los textos muy
  // largos para mantener el prompt bajo control y por seguridad el total
  // se corta a ~30 KB.
  const lines: string[] = [];
  let bytes = 0;
  const MAX_BYTES = 30 * 1024;
  for (const block of evidence.blocks) {
    const text = block.text.replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!text) continue;
    const line = `${block.locator} | ${text}`;
    if (bytes + line.length + 1 > MAX_BYTES) break;
    lines.push(line);
    bytes += line.length + 1;
  }
  return lines.join('\n');
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function normalizeKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 80);
  return trimmed || undefined;
}

function parseFindings(response: string, evidence: Evidence): Finding[] {
  const parsed = extractJson(response) as { findings?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.findings)) return [];
  const locators = new Set(evidence.blocks.map(b => b.locator));
  const findings: Finding[] = [];
  for (const raw of parsed.findings as RawFinding[]) {
    if (findings.length >= 120) break;
    if (!raw || typeof raw !== 'object') continue;
    const kind = typeof raw.kind === 'string' ? raw.kind.toUpperCase() : '';
    if (!VALID_KINDS.has(kind as FindingKind)) continue;
    const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 2000) : '';
    if (!text) continue;
    const locator = typeof raw.locator === 'string' ? raw.locator.trim() : '';
    if (!locator || !locators.has(locator)) continue;
    const key = normalizeKey(raw.key);
    const requirementKey = normalizeKey(raw.requirementKey);
    findings.push({
      kind: kind as FindingKind,
      text,
      source: { versionId: evidence.versionId, locator },
      key: isRequirement(kind as FindingKind) ? (key ?? requirementKey) : key,
      requirementKey: requirementKey ?? (isRequirement(kind as FindingKind) ? undefined : key),
      pendingConfirmation: raw.pendingConfirmation !== false,
    });
  }
  return findings;
}

@Injectable()
export class AiDocumentAnalyzer implements DocumentAnalysisProvider {
  private readonly ruleBased = new RuleBasedDocumentAnalyzer();

  constructor(private readonly router: AiRouter) {}

  async extract(evidence: Evidence, context: AnalyzeContext): Promise<Finding[]> {
    const prompt = serializeBlocks(evidence);
    if (!prompt) return this.ruleBased.extract(evidence, context);

    let response;
    try {
      response = await this.router.dispatch({
        operation: 'document-analysis',
        organizationId: context.organizationId,
        projectId: context.projectId,
        runKey: context.runKey,
        systemPrompt: SYSTEM_PROMPT,
        prompt,
        maxOutputTokens: 4096,
      });
    } catch {
      // El router maneja los errores internos; si igual propaga, no dejamos
      // al proyecto sin findings.
      return this.ruleBased.extract(evidence, context);
    }

    if (response.usedFallback) {
      // El router usó la respuesta cannead (sin plan o sin proveedor
      // configurado): eso no sirve para extraer findings, así que corremos
      // las reglas para no quedar con un IPA vacío.
      return this.ruleBased.extract(evidence, context);
    }

    const findings = parseFindings(response.text, evidence);
    if (!findings.length) return this.ruleBased.extract(evidence, context);
    return findings;
  }
}

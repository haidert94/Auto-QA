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
  'Eres un analista QA senior especializado en historias de usuario y requisitos funcionales.',
  'Vas a recibir un documento en Markdown y tu tarea es extraer findings estructurados.',
  '',
  'Reglas:',
  '- Solo propones findings cuyo "text" sea literal o una paráfrasis mínima del documento. Está prohibido inventar historias, criterios o actores.',
  '- Para cada historia de usuario, extrae la frase completa ("Como <rol> quiero <acción> para <valor>" o equivalente).',
  '- Para criterios de aceptación, extrae el enunciado completo y conserva la referencia al requisito superior cuando el documento la indique (por ejemplo "[HU-1]" o "Criterio de HU-1").',
  '- "pendingConfirmation" es true cuando el texto admite más de una interpretación razonable, menciona un rol o funcionalidad sin definirla, o depende de información no declarada en el documento.',
  '- Si identificas una llave visible (HU-1, RF-01, CA-2, REQ-3, RN-4, RNF-01, etc.), copiala literal en "key".',
  '- Para criterios de aceptación ligados a una historia/requisito, colocá esa llave superior en "requirementKey".',
  '',
  'Responde ÚNICAMENTE un JSON válido, sin markdown, sin texto antes ni después. Shape exacto:',
  '{"findings":[{"kind":"USER_STORY|REQUIREMENT|FUNCTIONAL|NON_FUNCTIONAL|ACCEPTANCE_CRITERION|BUSINESS_RULE|ROLE|PERMISSION|SCENARIO","text":"...","key":"HU-1","requirementKey":"HU-1","pendingConfirmation":false}]}',
  '',
  'Si no detectas nada reconocible, responde {"findings":[]}.',
].join('\n');

type RawFinding = {
  kind?: unknown;
  text?: unknown;
  key?: unknown;
  requirementKey?: unknown;
  pendingConfirmation?: unknown;
};

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

// Normaliza whitespace para comparar. Mantiene mayúsculas/minúsculas y
// acentos; el LLM parafraseos menores pierden match y se descartan.
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parseFindings(response: string, evidence: Evidence, markdown: string): Finding[] {
  const parsed = extractJson(response) as { findings?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.findings)) return [];
  const haystack = normalize(markdown).toLowerCase();
  const findings: Finding[] = [];
  let ordinal = 0;
  for (const raw of parsed.findings as RawFinding[]) {
    if (findings.length >= 200) break;
    if (!raw || typeof raw !== 'object') continue;
    const kind = typeof raw.kind === 'string' ? raw.kind.toUpperCase() : '';
    if (!VALID_KINDS.has(kind as FindingKind)) continue;
    const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 2000) : '';
    if (!text) continue;
    // Anti-alucinación: el texto debe aparecer (normalizado) en el
    // markdown original. Un parafraseo mayor del LLM se descarta.
    const normalizedText = normalize(text).toLowerCase();
    if (normalizedText.length < 10 || !haystack.includes(normalizedText.slice(0, Math.min(normalizedText.length, 120)))) continue;
    const key = normalizeKey(raw.key);
    const requirementKey = normalizeKey(raw.requirementKey);
    ordinal += 1;
    findings.push({
      kind: kind as FindingKind,
      text,
      // Locator a nivel documento + ordinal: perdemos línea pero
      // mantenemos trazabilidad al archivo. El rule-based sigue dando
      // locator fino cuando corre como fallback.
      source: { versionId: evidence.versionId, locator: `ai#${ordinal}` },
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
    // Sin markdown no hay nada que pedirle al LLM: delegamos al rule-based
    // que trabaja con los blocks originales.
    const markdown = evidence.markdown?.trim();
    if (!markdown) return this.ruleBased.extract(evidence, context);

    const prompt = [
      evidence.filename ? `Archivo: ${evidence.filename}` : '',
      '',
      'Documento:',
      markdown,
    ].filter(line => line !== undefined).join('\n');

    let response;
    try {
      response = await this.router.dispatch({
        operation: 'document-analysis',
        organizationId: context.organizationId,
        projectId: context.projectId,
        runKey: context.runKey,
        systemPrompt: SYSTEM_PROMPT,
        prompt,
        maxOutputTokens: 8192,
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

    const findings = parseFindings(response.text, evidence, markdown);
    if (!findings.length) return this.ruleBased.extract(evidence, context);
    return findings;
  }
}

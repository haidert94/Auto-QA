// Agente "revisor": construye el prompt que la IA responde en JSON y
// parsea/sanitiza la salida. Separado del service para poder cubrirlo
// con tests sin llamar al proveedor real.

export type StoryCoverage = 'completa' | 'parcial' | 'no-cubierta' | 'ambigua';

export type ReviewStory = {
  title: string;
  coverage: StoryCoverage;
  notes?: string;
};

export type ReviewCategory = {
  code: string;
  label: string;
  percent: number;
  detail?: string;
};

export type ReviewResult = {
  score: number;
  level: 'Óptimo' | 'Aceptable' | 'Mejorable' | 'Insuficiente';
  summary: string;
  categories: ReviewCategory[];
  stories: ReviewStory[];
  warnings: string[];
  recommendation: string;
};

export type ProjectContext = {
  projectName: string;
  baseUrl?: string | null;
  description?: string | null;
  documents: Array<{ filename: string; markdown: string }>;
};

export function levelFromScore(score: number): ReviewResult['level'] {
  if (score >= 85) return 'Óptimo';
  if (score >= 70) return 'Aceptable';
  if (score >= 50) return 'Mejorable';
  return 'Insuficiente';
}

export function buildReviewPrompt(context: ProjectContext): string {
  const docs = context.documents.length
    ? context.documents.map(d => `### ${d.filename}\n${d.markdown.slice(0, 20000)}`).join('\n\n')
    : '(sin documentos adjuntos)';

  return [
    'Eres un ingeniero QA senior revisando la documentación de un proyecto para automatización.',
    'Analiza los documentos y produce un diagnóstico de preparación (IPA) junto con un inventario de historias de usuario.',
    '',
    `Proyecto: ${context.projectName}`,
    context.baseUrl ? `URL base: ${context.baseUrl}` : '',
    context.description ? `Descripción: ${context.description}` : '',
    '',
    'Documentos:',
    docs,
    '',
    'Responde SOLO con un JSON válido, sin markdown ni texto fuera del JSON. Formato exacto:',
    '{',
    '  "score": 0-100,',
    '  "summary": "frase corta explicando el score",',
    '  "categories": [',
    '    { "code": "requisitos", "label": "Requisitos funcionales estructurados", "percent": 0-100, "detail": "..." },',
    '    { "code": "casos",      "label": "Casos de prueba atómicos con criterios de aceptación", "percent": 0-100, "detail": "..." },',
    '    { "code": "selectores", "label": "Definición de selectores y contratos de API", "percent": 0-100, "detail": "..." }',
    '  ],',
    '  "stories": [',
    '    { "title": "Como usuario quiero iniciar sesión", "coverage": "completa|parcial|no-cubierta|ambigua", "notes": "..." }',
    '  ],',
    '  "warnings": ["texto corto de cada ambigüedad o contradicción"],',
    '  "recommendation": "una frase con el próximo paso sugerido"',
    '}',
    '',
    'No inventes historias que no estén en los documentos. Si no hay documentos, devuelve score bajo y lista vacía de historias con un warning explicando la falta de documentación.',
  ].filter(Boolean).join('\n');
}

const VALID_COVERAGES: ReadonlySet<StoryCoverage> = new Set(['completa', 'parcial', 'no-cubierta', 'ambigua']);

function clampPercent(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// Normaliza la respuesta del LLM. Si la salida no es parseable o viene
// mal formada, devuelve un diagnóstico mínimo (score 0, warning).
export function parseReviewResponse(text: string): ReviewResult {
  const parsed = extractJson(text) as Record<string, unknown> | null;
  if (!parsed) {
    return {
      score: 0, level: 'Insuficiente',
      summary: 'La IA no devolvió un análisis parseable.',
      categories: [], stories: [],
      warnings: ['respuesta-no-json'],
      recommendation: 'Vuelve a subir los documentos o reintenta el análisis.',
    };
  }

  const score = clampPercent(parsed.score);
  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : '';
  const recommendation = typeof parsed.recommendation === 'string' ? parsed.recommendation.slice(0, 500) : '';

  const categories: ReviewCategory[] = Array.isArray(parsed.categories)
    ? parsed.categories
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .slice(0, 6)
      .map(c => ({
        code: typeof c.code === 'string' ? c.code.slice(0, 40) : 'categoria',
        label: typeof c.label === 'string' ? c.label.slice(0, 120) : 'Sin etiqueta',
        percent: clampPercent(c.percent),
        detail: typeof c.detail === 'string' ? c.detail.slice(0, 200) : undefined,
      }))
    : [];

  const stories: ReviewStory[] = Array.isArray(parsed.stories)
    ? parsed.stories
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .slice(0, 100)
      .map(s => {
        const rawCoverage = typeof s.coverage === 'string' ? s.coverage : 'no-cubierta';
        const coverage = (VALID_COVERAGES.has(rawCoverage as StoryCoverage)
          ? rawCoverage : 'no-cubierta') as StoryCoverage;
        return {
          title: typeof s.title === 'string' ? s.title.slice(0, 300) : 'Historia sin título',
          coverage,
          notes: typeof s.notes === 'string' ? s.notes.slice(0, 500) : undefined,
        };
      })
    : [];

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === 'string').slice(0, 20).map(w => w.slice(0, 300))
    : [];

  return {
    score, level: levelFromScore(score),
    summary, categories, stories, warnings, recommendation,
  };
}

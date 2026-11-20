// Detección de pasos duplicados/similares entre escenarios.
// - normalizeStepText elimina acentos, símbolos y stopwords de dominio para
//   agrupar frases equivalentes ("Cuando Ingresa la contraseña" vs
//   "Ingresa contraseña" vs "Ingrese su contraseña").
// - stepSimilarity usa Jaccard sobre tokens normalizados; es barato y
//   simétrico, suficiente para listar duplicados en una pestaña de calidad.
// - groupSimilarSteps agrupa por normalización exacta primero y, si se pasa
//   un umbral <1, fusiona grupos cuya intersección supere ese umbral.

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'en', 'con', 'sin', 'por', 'para', 'y', 'o', 'u', 'que', 'se', 'su',
  'sus', 'mi', 'tu', 'lo', 'le', 'les', 'es', 'ser', 'estar', 'esta',
  // conectores Gherkin castellanos; no aportan al significado del paso.
  'dado', 'cuando', 'entonces', 'pero', 'ademas',
]);

export function normalizeStepText(input: string): string {
  if (!input) return '';
  const cleaned = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.split(' ').filter(token => token && !STOPWORDS.has(token));
  return tokens.join(' ');
}

function tokens(normalized: string): Set<string> {
  if (!normalized) return new Set();
  return new Set(normalized.split(' ').filter(Boolean));
}

export function stepSimilarity(a: string, b: string): number {
  const ta = tokens(normalizeStepText(a));
  const tb = tokens(normalizeStepText(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type StepOccurrence = {
  scenarioId: string;
  scenarioTitle: string;
  ordinal: number;
  text: string;
};

export type DuplicateGroup = {
  normalized: string;
  canonicalText: string;
  occurrences: StepOccurrence[];
  scenarioCount: number;
};

export function groupSimilarSteps(occurrences: StepOccurrence[], threshold = 1): DuplicateGroup[] {
  const buckets = new Map<string, StepOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = normalizeStepText(occurrence.text);
    if (!key) continue;
    const existing = buckets.get(key);
    if (existing) existing.push(occurrence);
    else buckets.set(key, [occurrence]);
  }

  let groups: DuplicateGroup[] = [...buckets.entries()].map(([normalized, list]) => ({
    normalized,
    canonicalText: pickCanonical(list),
    occurrences: list,
    scenarioCount: new Set(list.map(item => item.scenarioId)).size,
  }));

  if (threshold < 1) {
    groups = mergeByThreshold(groups, threshold);
  }

  return groups
    .filter(group => group.occurrences.length > 1)
    .sort((a, b) => b.occurrences.length - a.occurrences.length || b.scenarioCount - a.scenarioCount);
}

function pickCanonical(list: StepOccurrence[]): string {
  // El texto canónico es el más corto: en la práctica suele ser la forma
  // sin conectores Gherkin (Dado/Cuando) ni adornos; sirve como etiqueta en
  // la UI sin inventar palabras nuevas.
  return list.slice().sort((a, b) => a.text.length - b.text.length)[0].text;
}

function mergeByThreshold(groups: DuplicateGroup[], threshold: number): DuplicateGroup[] {
  // O(n²) sobre el número de grupos únicos (no sobre pasos); viable hasta
  // unos miles de pasos distintos por proyecto. Si crece, mover a trigramas.
  const result: DuplicateGroup[] = [];
  const merged = new Set<number>();
  for (let i = 0; i < groups.length; i++) {
    if (merged.has(i)) continue;
    const base = { ...groups[i], occurrences: [...groups[i].occurrences] };
    for (let j = i + 1; j < groups.length; j++) {
      if (merged.has(j)) continue;
      if (stepSimilarity(groups[i].canonicalText, groups[j].canonicalText) >= threshold) {
        merged.add(j);
        base.occurrences.push(...groups[j].occurrences);
      }
    }
    base.scenarioCount = new Set(base.occurrences.map(item => item.scenarioId)).size;
    base.canonicalText = pickCanonical(base.occurrences);
    result.push(base);
  }
  return result;
}

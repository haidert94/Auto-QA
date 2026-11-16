// Utilidades de diff puras, sin BD. Usadas por runs y explorations para
// comparar dos snapshots del mismo recurso.

export type ResultStatus = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';

export type DiffResult = {
  scenarioId: string;
  from: ResultStatus | null;
  to: ResultStatus | null;
  durationFromMs: number | null;
  durationToMs: number | null;
};

// Compara resultados de dos runs por scenarioId. Un scenario presente en
// un lado y ausente en el otro aparece con `from = null` o `to = null`.
export function diffResults(
  previous: { scenarioId: string; status: ResultStatus; durationMs: number | null }[],
  current: { scenarioId: string; status: ResultStatus; durationMs: number | null }[],
): DiffResult[] {
  const byScenarioPrev = new Map(previous.map(r => [r.scenarioId, r]));
  const byScenarioCurr = new Map(current.map(r => [r.scenarioId, r]));
  const ids = new Set<string>([...byScenarioPrev.keys(), ...byScenarioCurr.keys()]);
  const out: DiffResult[] = [];
  for (const id of ids) {
    const p = byScenarioPrev.get(id) ?? null;
    const c = byScenarioCurr.get(id) ?? null;
    if (p?.status === c?.status && (p?.durationMs ?? null) === (c?.durationMs ?? null)) continue;
    out.push({
      scenarioId: id,
      from: p?.status ?? null,
      to: c?.status ?? null,
      durationFromMs: p?.durationMs ?? null,
      durationToMs: c?.durationMs ?? null,
    });
  }
  return out;
}

export type ExplorationPageLike = { url: string; httpStatus: number | null };

export type ExplorationDiff = {
  added: ExplorationPageLike[];
  removed: ExplorationPageLike[];
  statusChanged: Array<{ url: string; from: number | null; to: number | null }>;
};

export function diffExplorations(
  previous: ExplorationPageLike[],
  current: ExplorationPageLike[],
): ExplorationDiff {
  const prevByUrl = new Map(previous.map(p => [p.url, p]));
  const currByUrl = new Map(current.map(p => [p.url, p]));
  const added: ExplorationPageLike[] = [];
  const removed: ExplorationPageLike[] = [];
  const statusChanged: ExplorationDiff['statusChanged'] = [];
  for (const [url, page] of currByUrl) {
    if (!prevByUrl.has(url)) added.push(page);
    else if (prevByUrl.get(url)!.httpStatus !== page.httpStatus) {
      statusChanged.push({ url, from: prevByUrl.get(url)!.httpStatus, to: page.httpStatus });
    }
  }
  for (const [url, page] of prevByUrl) {
    if (!currByUrl.has(url)) removed.push(page);
  }
  return { added, removed, statusChanged };
}

// Diff textual simple: devuelve si cambió, y una comparación línea a línea
// suficiente para que la UI muestre "N líneas añadidas / N quitadas" sin
// depender de una lib de diff. No es un algoritmo LCS; cuenta solo las
// diferencias en las líneas mismas (orden-sensible), lo cual basta para
// specs generados mecánicamente.
export type TextDiffSummary = {
  changed: boolean;
  previousLines: number;
  currentLines: number;
  addedLines: number;
  removedLines: number;
};

export function diffText(previous: string | null, current: string | null): TextDiffSummary {
  const prev = (previous ?? '').split(/\r?\n/);
  const curr = (current ?? '').split(/\r?\n/);
  if ((previous ?? '') === (current ?? '')) {
    return { changed: false, previousLines: prev.length, currentLines: curr.length, addedLines: 0, removedLines: 0 };
  }
  const prevSet = new Set(prev);
  const currSet = new Set(curr);
  let added = 0;
  let removed = 0;
  for (const line of curr) if (!prevSet.has(line)) added += 1;
  for (const line of prev) if (!currSet.has(line)) removed += 1;
  return { changed: true, previousLines: prev.length, currentLines: curr.length, addedLines: added, removedLines: removed };
}

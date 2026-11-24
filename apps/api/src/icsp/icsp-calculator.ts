// Calculador del ICSP (Índice Compuesto de Salud del Producto). Función pura:
// recibe requisitos, escenarios y resultados ya cargados, devuelve el índice
// con dimensiones, puntos por dimensión y listas de gaps enlazables.
//
// Pesos documentados en README y verificables aquí:
//   requirementsCoverage = 30%
//   executionCoverage    = 20%
//   stability            = 30%
//   traceability         = 20%

export type IcspRequirement = { id: string; title: string; externalKey?: string | null };

export type IcspScenario = {
  id: string;
  title: string;
  requirementId: string | null;
};

export type IcspResult = { id: string; status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED' | 'MEASURED' };

export type IcspRun = {
  id: string;
  scenarioId: string | null;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  createdAt: Date;
  results: IcspResult[];
};

export type IcspInput = {
  now: Date;
  recentWindowDays: number;
  requirements: IcspRequirement[];
  scenarios: IcspScenario[];
  runs: IcspRun[];
};

export type IcspDimension = {
  code: 'requirementsCoverage' | 'executionCoverage' | 'stability' | 'traceability';
  label: string;
  weight: number;
  value: number;       // 0..1
  numerator: number;
  denominator: number;
  description: string;
};

export type IcspGap = {
  kind: 'requirement-without-scenario' | 'scenario-not-executed' | 'scenario-unstable';
  id: string;
  label: string;
  detail?: string;
};

export type IcspReport = {
  score: number;              // 0..100 entero
  dimensions: IcspDimension[];
  gaps: {
    requirementsWithoutScenario: IcspGap[];
    scenariosNotExecuted: IcspGap[];
    unstableScenarios: IcspGap[];
  };
  counts: {
    requirements: number;
    scenarios: number;
    runs: number;
    results: number;
    passed: number;
    failed: number;
  };
  window: { from: string; to: string; days: number };
};

export function computeIcsp(input: IcspInput): IcspReport {
  const windowMs = input.recentWindowDays * 24 * 60 * 60 * 1000;
  const windowStart = new Date(input.now.getTime() - windowMs);

  const scenariosByRequirement = new Map<string, IcspScenario[]>();
  for (const scenario of input.scenarios) {
    if (!scenario.requirementId) continue;
    const list = scenariosByRequirement.get(scenario.requirementId) ?? [];
    list.push(scenario);
    scenariosByRequirement.set(scenario.requirementId, list);
  }

  const runsByScenario = new Map<string, IcspRun[]>();
  for (const run of input.runs) {
    if (!run.scenarioId) continue;
    const list = runsByScenario.get(run.scenarioId) ?? [];
    list.push(run);
    runsByScenario.set(run.scenarioId, list);
  }

  // Dimensión 1: % de requisitos con al menos un escenario vinculado.
  const reqsWithScenario = input.requirements.filter(r => scenariosByRequirement.has(r.id));
  const requirementsCoverage: IcspDimension = {
    code: 'requirementsCoverage', label: 'Cobertura de requisitos', weight: 30,
    numerator: reqsWithScenario.length, denominator: input.requirements.length,
    value: ratio(reqsWithScenario.length, input.requirements.length),
    description: 'Requisitos con al menos una prueba asociada, incluidas las pruebas de calidad.',
  };

  // Dimensión 2: escenarios con al menos un run en la ventana reciente.
  const scenariosRecentlyRun = input.scenarios.filter(s => {
    const runs = runsByScenario.get(s.id) ?? [];
    return runs.some(r => r.createdAt >= windowStart);
  });
  const executionCoverage: IcspDimension = {
    code: 'executionCoverage', label: 'Cobertura de ejecución', weight: 20,
    numerator: scenariosRecentlyRun.length, denominator: input.scenarios.length,
    value: ratio(scenariosRecentlyRun.length, input.scenarios.length),
    description: `Escenarios con alguna ejecución en los últimos ${input.recentWindowDays} días.`,
  };

  // Dimensión 3: passed / (passed + failed) sobre los resultados en la ventana.
  let passed = 0;
  let failed = 0;
  let totalResults = 0;
  for (const run of input.runs) {
    if (run.createdAt < windowStart) continue;
    for (const result of run.results) {
      totalResults += 1;
      if (result.status === 'PASSED') passed += 1;
      else if (result.status === 'FAILED') failed += 1;
    }
  }
  const stability: IcspDimension = {
    code: 'stability', label: 'Estabilidad', weight: 30,
    numerator: passed, denominator: passed + failed,
    value: ratio(passed, passed + failed),
    description: 'Proporción de resultados en verde entre ejecuciones concluyentes de la ventana.',
  };

  // Dimensión 4: cadena completa requisito → prueba → resultado o medición.
  const reqsWithChain = input.requirements.filter(r => {
    const scenarios = scenariosByRequirement.get(r.id) ?? [];
    return scenarios.some(s => {
      const runs = runsByScenario.get(s.id) ?? [];
      return runs.some(run => run.results.some(res => res.status === 'PASSED' || res.status === 'FAILED' || res.status === 'MEASURED'));
    });
  });
  const traceability: IcspDimension = {
    code: 'traceability', label: 'Trazabilidad', weight: 20,
    numerator: reqsWithChain.length, denominator: input.requirements.length,
    value: ratio(reqsWithChain.length, input.requirements.length),
    description: 'Requisitos con una prueba asociada que tiene un resultado o una medición registrada.',
  };

  const dimensions: IcspDimension[] = [requirementsCoverage, executionCoverage, stability, traceability];
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const weightedSum = dimensions.reduce((sum, d) => sum + d.weight * d.value, 0);
  const score = Math.round(100 * weightedSum / totalWeight);

  // Gaps: evidencia accionable para cada dimensión.
  const requirementsWithoutScenario: IcspGap[] = input.requirements
    .filter(r => !scenariosByRequirement.has(r.id))
    .map(r => ({ kind: 'requirement-without-scenario', id: r.id, label: r.externalKey ? `[${r.externalKey}] ${r.title}` : r.title }));

  const scenariosNotExecuted: IcspGap[] = input.scenarios
    .filter(s => !(runsByScenario.get(s.id) ?? []).some(r => r.createdAt >= windowStart))
    .map(s => ({ kind: 'scenario-not-executed', id: s.id, label: s.title }));

  const unstableScenarios: IcspGap[] = [];
  for (const s of input.scenarios) {
    const runs = runsByScenario.get(s.id) ?? [];
    const recent = runs.filter(r => r.createdAt >= windowStart);
    let p = 0; let f = 0;
    for (const run of recent) for (const res of run.results) {
      if (res.status === 'PASSED') p += 1;
      else if (res.status === 'FAILED') f += 1;
    }
    const total = p + f;
    if (total < 2) continue;
    if (p >= total) continue;
    unstableScenarios.push({
      kind: 'scenario-unstable', id: s.id, label: s.title,
      detail: `${p}/${total} pasaron en ${input.recentWindowDays}d`,
    });
  }

  return {
    score,
    dimensions,
    gaps: { requirementsWithoutScenario, scenariosNotExecuted, unstableScenarios },
    counts: {
      requirements: input.requirements.length,
      scenarios: input.scenarios.length,
      runs: input.runs.length,
      results: totalResults,
      passed, failed,
    },
    window: {
      from: windowStart.toISOString(),
      to: input.now.toISOString(),
      days: input.recentWindowDays,
    },
  };
}

function ratio(num: number, den: number): number {
  if (den === 0) return 1; // 0/0 lo tratamos como "nada que medir" → 100%.
  return num / den;
}

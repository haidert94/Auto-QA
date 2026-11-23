// Parseo puro del summary.json que k6 exporta con --summary-export.
// Separado del runner para poderlo cubrir con tests sin instalar k6.

export type LoadStage = { duration: string; target: number };

export const DEFAULT_K6_LIMITS = { p95Ms: 2000, errorRate: 0.05 };

const DEFAULT_K6_THRESHOLDS = {
  http_req_duration: ['p(95)<' + DEFAULT_K6_LIMITS.p95Ms],
  http_req_failed: ['rate<' + DEFAULT_K6_LIMITS.errorRate],
};

export type LoadMetrics = {
  totalRequests: number | null;
  reqPerSec: number | null;
  failRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxVus: number | null;
  durationSec: number | null;
};

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function intMs(value: unknown): number | null {
  const v = num(value);
  return v === null ? null : Math.round(v);
}

export function parseK6Summary(raw: unknown): LoadMetrics {
  const report = (raw ?? {}) as { metrics?: Record<string, unknown>; state?: unknown };
  const metrics = report.metrics ?? {};
  const httpReqs = metrics['http_reqs'] as { count?: unknown; rate?: unknown } | undefined;
  const httpReqFailed = metrics['http_req_failed'] as { value?: unknown } | undefined;
  const httpReqDuration = metrics['http_req_duration'] as {
    med?: unknown; 'p(95)'?: unknown; 'p(99)'?: unknown;
  } | undefined;
  const vus = metrics['vus_max'] as { max?: unknown; value?: unknown } | undefined;
  const state = report.state as { testRunDurationMs?: unknown } | undefined;

  return {
    totalRequests: intMs(httpReqs?.count),
    reqPerSec: num(httpReqs?.rate),
    failRate: num(httpReqFailed?.value),
    p50Ms: intMs(httpReqDuration?.med),
    p95Ms: intMs(httpReqDuration?.['p(95)']),
    p99Ms: intMs(httpReqDuration?.['p(99)']),
    maxVus: intMs(vus?.max ?? vus?.value),
    durationSec: state?.testRunDurationMs != null && typeof state.testRunDurationMs === 'number'
      ? Math.round(state.testRunDurationMs / 1000) : null,
  };
}

// Escape conservador para literales de string con comillas simples, mismo
// conjunto que playwright-generator (backslash, comillas, newlines, line
// separators). Lo redefinimos acá para evitar importar entre features.
const LINE_SEPARATOR = new RegExp('[\\u2028\\u2029]', 'g');
function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(LINE_SEPARATOR, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function validateStage(stage: LoadStage): LoadStage {
  if (!/^\d+[smh]$/.test(stage.duration)) throw new Error('Duración de stage inválida: ' + stage.duration);
  if (!Number.isInteger(stage.target) || stage.target < 0 || stage.target > 1000) {
    throw new Error('Target de stage fuera de rango: ' + stage.target);
  }
  return stage;
}

export function readLoadStages(value: unknown): LoadStage[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const stages: LoadStage[] = [];
  for (const stage of value) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)
      || typeof stage.duration !== 'string' || typeof stage.target !== 'number') return null;
    try {
      stages.push(validateStage({ duration: stage.duration, target: stage.target }));
    } catch {
      return null;
    }
  }
  return stages;
}

export function totalLoadSeconds(stages: { duration: string }[]): number {
  return stages.reduce((seconds, { duration }) => {
    const units = { s: 1, m: 60, h: 3600 } as const;
    const match = /^(\d+)([smh])$/.exec(duration);
    return match ? seconds + Number(match[1]) * units[match[2] as keyof typeof units] : seconds;
  }, 0);
}

// Genera el script k6 que ejecuta una carga GET contra la URL dada. Los
// stages y la URL son del operador autenticado; se escapan como literales
// JS para evitar inyección.
export function generateK6Script(options: {
  url: string;
  stages: LoadStage[];
  thresholds?: Record<string, string[]>;
  standalone?: { needsQuery: boolean };
}): string {
  const url = esc(options.url);
  const querySetup = options.standalone?.needsQuery ? [
    "const query = __ENV.AUTOQA_TARGET_QUERY;",
    "if (!query || !query.startsWith('?')) throw new Error('Define AUTOQA_TARGET_QUERY con los parámetros del entorno autorizado.');",
    '',
  ] : [];
  const target = "'" + url + "'" + (options.standalone?.needsQuery ? ' + query' : '');
  const stages = options.stages.map(validateStage)
    .map(s => `{ duration: '${esc(s.duration)}', target: ${s.target} }`).join(', ');
  const thresholds = options.thresholds ?? DEFAULT_K6_THRESHOLDS;
  const thresholdLines = Object.entries(thresholds).map(([metric, rules]) =>
    `    ${JSON.stringify(metric)}: [${rules.map(r => `'${esc(r)}'`).join(', ')}]`
  ).join(',\n');

  return [
    "import http from 'k6/http';",
    "import { check, sleep } from 'k6';",
    '',
    ...querySetup,
    'export const options = {',
    ...(options.standalone ? ['  maxRedirects: 0,'] : []),
    `  stages: [${stages}],`,
    '  thresholds: {',
    thresholdLines,
    '  },',
    '};',
    '',
    'export default function () {',
    `  const res = http.get(${target});`,
    "  check(res, { 'status < 400': r => r.status < 400 });",
    '  sleep(1);',
    '}',
    '',
  ].join('\n');
}

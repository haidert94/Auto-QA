import { Injectable, Logger } from '@nestjs/common';

// Consulta la salud del repositorio de GitHub (CI runs, CodeQL alerts,
// Dependabot alerts) usando la REST API. El token y el repo se leen de
// variables de entorno; si faltan, el endpoint devuelve configured:false
// para que la UI muestre la nota de configuración en vez de romper.
//
// Variables esperadas:
//   AUTOQA_GITHUB_TOKEN  → PAT fine-grained con permisos:
//                          contents:read, actions:read,
//                          security_events:read, dependabot:read
//   AUTOQA_GITHUB_REPO   → owner/name (por defecto haidert94/Auto-QA)
//   AUTOQA_GITHUB_WORKFLOW → nombre del workflow a reportar (por defecto ci.yml)
//
// El servicio cachea la respuesta 2 min en memoria para no agotar la
// cuota de la API (5000 req/hora por token) si el panel se recarga.

type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'error' | 'warning' | 'note' | 'other';
export type AlertCounts = Record<AlertSeverity | 'total', number>;

export type WorkflowRunSummary = { id: number; status: string; conclusion: string | null; createdAt: string; url: string; headSha: string };

// Detalle por alerta: suficiente para que el usuario decida si abrirla en
// GitHub o ir directo al archivo. No incluimos la descripción completa para
// evitar inflar el payload; está en el enlace.
export type AlertDetail = {
  id: number;
  severity: AlertSeverity;
  title: string;
  location: string | null;
  url: string;
  package?: string;
};

export type CodeHealthResult = {
  configured: boolean;
  repository: string | null;
  fetchedAt: string;
  workflow: {
    name: string;
    recent: WorkflowRunSummary[];
    successRate: number | null;
    evaluated: number;
    succeeded: number;
    url: string;
  } | null;
  codeql: { enabled: boolean; counts: AlertCounts; url: string | null; top: AlertDetail[] } | null;
  dependabot: { enabled: boolean; counts: AlertCounts; url: string | null; top: AlertDetail[] } | null;
  message?: string;
};

const SECURITY_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, high: 1, error: 2, medium: 3, warning: 4, low: 5, note: 6, other: 7 };
const CI_CONCLUSIONS = new Set(['success', 'failure', 'timed_out', 'startup_failure']);

const EMPTY_COUNTS: AlertCounts = { critical: 0, high: 0, medium: 0, low: 0, error: 0, warning: 0, note: 0, other: 0, total: 0 };

function securitySeverity(value: unknown) {
  return SECURITY_SEVERITIES.find(level => level === value);
}

function codeqlSeverity(rule: { security_severity_level?: string; severity?: string } | null): AlertSeverity {
  const level = rule?.severity;
  return securitySeverity(rule?.security_severity_level) ?? securitySeverity(level)
    ?? (level === 'error' || level === 'warning' || level === 'note' ? level : 'other');
}

const CACHE_TTL_MS = 2 * 60 * 1000;

@Injectable()
export class CodeHealthService {
  private readonly log = new Logger(CodeHealthService.name);
  private cache: { value: CodeHealthResult; expiresAt: number } | null = null;

  async read(): Promise<CodeHealthResult> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const token = process.env.AUTOQA_GITHUB_TOKEN?.trim();
    const repository = process.env.AUTOQA_GITHUB_REPO?.trim() || 'haidert94/Auto-QA';
    const workflow = process.env.AUTOQA_GITHUB_WORKFLOW?.trim() || 'ci.yml';
    if (!token) {
      const value: CodeHealthResult = {
        configured: false, repository: null, fetchedAt: new Date().toISOString(),
        workflow: null, codeql: null, dependabot: null,
        message: 'Define AUTOQA_GITHUB_TOKEN y AUTOQA_GITHUB_REPO para activar la salud del código.',
      };
      this.cache = { value, expiresAt: Date.now() + 60 * 1000 };
      return value;
    }
    const [runs, codeql, dependabot] = await Promise.all([
      this.fetchWorkflowRuns(repository, workflow, token),
      this.fetchCodeqlAlerts(repository, token),
      this.fetchDependabotAlerts(repository, token),
    ]);
    const value: CodeHealthResult = {
      configured: true, repository, fetchedAt: new Date().toISOString(),
      workflow: runs, codeql, dependabot,
    };
    this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  private async githubFetch(path: string, token: string): Promise<{ status: number; body: unknown }> {
    const url = `https://api.github.com${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'autoqa-code-health',
        },
        signal: controller.signal,
      });
      const body = response.status === 204 ? null : await response.json().catch(() => null);
      return { status: response.status, body };
    } catch (reason) {
      this.log.warn(`github ${path} falló: ${reason instanceof Error ? reason.message : 'error desconocido'}`);
      return { status: 0, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchWorkflowRuns(repo: string, workflow: string, token: string): Promise<CodeHealthResult['workflow']> {
    const { status, body } = await this.githubFetch(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=20`, token);
    const url = `https://github.com/${repo}/actions/workflows/${encodeURIComponent(workflow)}`;
    if (status !== 200 || !body || typeof body !== 'object') {
      return { name: workflow, recent: [], successRate: null, evaluated: 0, succeeded: 0, url };
    }
    const runs = Array.isArray((body as { workflow_runs?: unknown[] }).workflow_runs)
      ? (body as { workflow_runs: Array<Record<string, unknown>> }).workflow_runs : [];
    const recent: WorkflowRunSummary[] = runs.slice(0, 20).map(run => ({
      id: typeof run.id === 'number' ? run.id : 0,
      status: typeof run.status === 'string' ? run.status : 'unknown',
      conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
      createdAt: typeof run.created_at === 'string' ? run.created_at : '',
      url: typeof run.html_url === 'string' ? run.html_url : '',
      headSha: typeof run.head_sha === 'string' ? run.head_sha.slice(0, 7) : '',
    }));
    const evaluated = recent.filter(run => run.status === 'completed' && CI_CONCLUSIONS.has(run.conclusion ?? ''));
    const succeeded = evaluated.filter(run => run.conclusion === 'success').length;
    return { name: workflow, recent, successRate: evaluated.length ? succeeded / evaluated.length : null,
      evaluated: evaluated.length, succeeded, url };
  }

  private async fetchCodeqlAlerts(repo: string, token: string): Promise<CodeHealthResult['codeql']> {
    const { status, body } = await this.githubFetch(`/repos/${repo}/code-scanning/alerts?state=open&per_page=100`, token);
    if (status === 404) return { enabled: false, counts: { ...EMPTY_COUNTS }, url: `https://github.com/${repo}/security/code-scanning`, top: [] };
    if (status !== 200 || !Array.isArray(body)) return null;
    const counts = { ...EMPTY_COUNTS };
    const details: AlertDetail[] = [];
    for (const alert of body as Array<Record<string, unknown>>) {
      const rule = alert.rule as { severity?: string; security_severity_level?: string; description?: string; id?: string } | null;
      const severity = codeqlSeverity(rule);
      counts[severity]++; counts.total++;
      const instance = alert.most_recent_instance as { location?: { path?: string; start_line?: number } } | undefined;
      const loc = instance?.location;
      details.push({
        id: typeof alert.number === 'number' ? alert.number : 0,
        severity,
        title: typeof rule?.description === 'string' ? rule.description : (typeof rule?.id === 'string' ? rule.id : 'Alerta CodeQL'),
        location: loc?.path ? `${loc.path}${loc.start_line ? `:${loc.start_line}` : ''}` : null,
        url: typeof alert.html_url === 'string' ? alert.html_url : `https://github.com/${repo}/security/code-scanning`,
      });
    }
    details.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return { enabled: true, counts, url: `https://github.com/${repo}/security/code-scanning`, top: details };
  }

  private async fetchDependabotAlerts(repo: string, token: string): Promise<CodeHealthResult['dependabot']> {
    const { status, body } = await this.githubFetch(`/repos/${repo}/dependabot/alerts?state=open&per_page=100`, token);
    if (status === 404 || status === 403) return { enabled: false, counts: { ...EMPTY_COUNTS }, url: `https://github.com/${repo}/security/dependabot`, top: [] };
    if (status !== 200 || !Array.isArray(body)) return null;
    const counts = { ...EMPTY_COUNTS };
    const details: AlertDetail[] = [];
    for (const alert of body as Array<Record<string, unknown>>) {
      const advisory = alert.security_advisory as { severity?: string; summary?: string } | null;
      const dep = (alert.dependency as { package?: { name?: string; ecosystem?: string }; manifest_path?: string } | null) ?? null;
      const severity = securitySeverity(advisory?.severity) ?? 'other';
      counts[severity]++; counts.total++;
      details.push({
        id: typeof alert.number === 'number' ? alert.number : 0,
        severity,
        title: typeof advisory?.summary === 'string' ? advisory.summary : 'Vulnerabilidad en dependencia',
        location: dep?.manifest_path ?? null,
        url: typeof alert.html_url === 'string' ? alert.html_url : `https://github.com/${repo}/security/dependabot`,
        package: dep?.package?.name,
      });
    }
    details.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return { enabled: true, counts, url: `https://github.com/${repo}/security/dependabot`, top: details };
  }
}

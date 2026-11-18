import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const sessionCookie = 'autoqa_session';
const tokenPattern = /^[a-f0-9]{64}$/;

export function setting(name: string) {
  if (process.env[name] !== undefined) return process.env[name];
  try { return parseEnv(readFileSync(resolve(process.cwd(), '../../.env'), 'utf8'))[name]; }
  catch { return undefined; }
}

export function legacyWorkspace() {
  return setting('AUTOQA_LEGACY_MODE') === 'true' && setting('AUTOQA_DEPLOYMENT') !== 'hosted';
}

export async function sessionToken() {
  const token = (await cookies()).get(sessionCookie)?.value;
  return token && tokenPattern.test(token) ? token : undefined;
}

function apiOrigin() {
  const raw = setting('AUTOQA_INTERNAL_API_URL') ?? 'http://127.0.0.1:3001/api';
  const url = new URL(raw);
  if (url.pathname !== '/api' || url.search || url.hash || url.username || url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Configura el origen interno de AutoQA.');
  }
  return url.href;
}

export async function accountFetch(path: string, init: RequestInit = {}, options: { public?: boolean; documents?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (!options.public) {
    const token = (await sessionToken()) || (options.documents && legacyWorkspace() ? setting('AUTOQA_DOCUMENTS_TOKEN') : undefined);
    if (token) headers.set('Authorization', 'Bearer ' + token);
  }
  return fetch(apiOrigin() + path, { ...init, headers, redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(options.documents ? 75000 : 8000) });
}

export const activeStatuses = ['ACTIVE', 'TRIALING'];
export type CapabilityAvailability = 'OPERATIONAL' | 'BETA' | 'UPCOMING' | 'NOT_INCLUDED';
export type PlanCapability = {
  code: string; label: string; detail: string | null; position: number; availability: CapabilityAvailability;
  browsers: string[]; monthlyLimit: number | null; monitorLimit: number | null; minIntervalMinutes: number | null;
  maxVirtualUsers: number | null; maxDurationMinutes: number | null;
};
export type Usage = {
  month: string; projects: { used: number; limit: number };
  roles: { limit: number; projects: { id: string; name: string; used: number }[] };
  browser: { secondsUsed: number; secondsReserved: number; minutesLimit: number; availability: CapabilityAvailability };
  runs: { active: number; simultaneousLimit: number; completed: number; availability: CapabilityAvailability };
  monitors: { active: number; limit: number; availability: CapabilityAvailability };
  performance: { used: number; previousPending: number; limit: number; availability: CapabilityAvailability };
};

export type Plan = {
  code: string; name: string; priceCop: number; maxProjects: number; maxRoles: number;
  parallelRuns: number; runAvailability: CapabilityAvailability; capabilities: PlanCapability[];
};

export type OrgRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
export type Account = {
  name: string; email: string; role: OrgRole;
  organization: { id: string; name: string };
  subscription: { status: string; plan?: Plan; checkoutPrepared: boolean; periodEndsAt?: string; quotedPriceCop?: number | null };
  sandbox: boolean;
};

export async function listPlans(): Promise<Plan[]> {
  try {
    const response = await accountFetch('/commerce/plans', {}, { public: true });
    if (!response.ok) {
      console.error('[listPlans] API respondió', response.status);
      return [];
    }
    return await response.json();
  } catch (e) {
    console.error('[listPlans] fetch falló:', e instanceof Error ? e.name + ':' + e.message : String(e));
    return [];
  }
}

export async function requireAccount(): Promise<Account> {
  if (!await sessionToken()) redirect('/login');
  const response = await accountFetch('/commerce/me');
  if (response.status === 401) redirect('/login');
  if (!response.ok) throw new Error('No se pudo consultar tu cuenta.');
  return response.json();
}

export async function requireWorkspace() {
  if (!await sessionToken() && legacyWorkspace()) return;
  const account = await requireAccount();
  if (!activeStatuses.includes(account.subscription.status)) redirect('/billing');
}

export function allowedOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (request.method === 'GET' && !origin) return true;
  const configured = setting('AUTOQA_ACCOUNT_ORIGIN');
  if (configured) return origin === configured;
  const host = request.headers.get('host') ?? '';
  return /^(localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host) && origin === 'http://' + host;
}

export function responseCopy(response: Response) {
  return new Response(response.body, { status: response.status, headers: {
    'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store',
  } });
}

export function failure(message: string, status: number) {
  return Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function projectProxy(request: Request, pathname: string, documents = false) {
  if (!allowedOrigin(request)) return failure('Solicitud fuera del origen de AutoQA.', 403);
  const headers = new Headers();
  const type = request.headers.get('content-type');
  if (type) headers.set('Content-Type', type);
  if (documents && request.method === 'POST' && pathname.endsWith('/documents')) {
    const length = Number(request.headers.get('content-length'));
    if (!type?.startsWith('multipart/form-data;')) return failure('Envía los archivos como multipart.', 415);
    if (!Number.isSafeInteger(length) || length <= 0 || length > 26 * 1024 * 1024) return failure('Tamaño de solicitud no admitido.', 413);
    headers.set('Content-Length', String(length));
  }
  try {
    return responseCopy(await accountFetch(pathname, {
      method: request.method, body: request.body, duplex: 'half', headers,
    } as RequestInit & { duplex: 'half' }, { documents }));
  } catch { return failure('No se pudo comunicar con la API de AutoQA.', 502); }
}

// Guard de URL para la exploración Playwright de fase 5.
// Protege contra SSRF, DNS rebinding, redirecciones a redes privadas y
// esquemas no soportados. Funciones puras; la resolución DNS se inyecta
// como dependencia para que los tests no toquen la red.

import { isIP } from 'node:net';
import { Resolver } from 'node:dns/promises';

export type GuardIssue =
  | 'invalid-url'
  | 'disallowed-protocol'
  | 'credentials-in-url'
  | 'host-not-in-allowlist'
  | 'path-not-allowed'
  | 'path-excluded'
  | 'ip-literal'
  | 'dns-failure'
  | 'loopback-address'
  | 'private-address'
  | 'link-local-address'
  | 'unique-local-address'
  | 'multicast-address'
  | 'reserved-address'
  | 'unspecified-address';

export type GuardScope = {
  allowedHosts: string[];
  allowedPaths?: string[];
  excludedPaths?: string[];
};

export type AddressResolver = (host: string) => Promise<string[]>;

export type GuardResult =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; issue: GuardIssue; detail?: string };

export type SyncGuardResult =
  | { ok: true; url: URL }
  | { ok: false; issue: GuardIssue; detail?: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function classifyAddress(address: string): 'public' | GuardIssue {
  const version = isIP(address);
  if (version === 4) return classifyIPv4(address);
  if (version === 6) return classifyIPv6(address);
  return 'invalid-url';
}

function classifyIPv4(address: string): 'public' | GuardIssue {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return 'invalid-url';
  const [a, b] = parts;
  if (a === 0) return 'unspecified-address';
  if (a === 127) return 'loopback-address';
  if (a === 10) return 'private-address';
  if (a === 172 && b >= 16 && b <= 31) return 'private-address';
  if (a === 192 && b === 168) return 'private-address';
  if (a === 169 && b === 254) return 'link-local-address';
  if (a === 100 && b >= 64 && b <= 127) return 'reserved-address';
  if (a >= 224 && a <= 239) return 'multicast-address';
  if (a >= 240) return 'reserved-address';
  if (a === 192 && b === 0) return 'reserved-address';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved-address';
  if (a === 203 && b === 0) return 'reserved-address';
  return 'public';
}

function classifyIPv6(address: string): 'public' | GuardIssue {
  const normalized = address.toLowerCase().replace(/%.*$/, '');
  if (normalized === '::' || normalized === '::0') return 'unspecified-address';
  if (normalized === '::1') return 'loopback-address';
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe80::')) return 'link-local-address';
  const firstHex = normalized.split(':')[0];
  if (firstHex.length > 0) {
    const first = parseInt(firstHex, 16);
    if (first >= 0xfc00 && first <= 0xfdff) return 'unique-local-address';
    if (first >= 0xff00) return 'multicast-address';
  }
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  if (mapped) return classifyIPv4(mapped[1]);
  return 'public';
}

function hostAllowed(host: string, allowed: string[]): boolean {
  const target = host.toLowerCase();
  return allowed.some(entry => {
    const expected = entry.toLowerCase();
    if (target === expected) return true;
    return target.endsWith('.' + expected);
  });
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  if (prefix === '/' || prefix === '') return true;
  const clean = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === clean || path.startsWith(clean + '/');
}

export const defaultResolver: AddressResolver = async (host) => {
  const resolver = new Resolver();
  const results: string[] = [];
  await Promise.all([
    resolver.resolve4(host).then(addrs => results.push(...addrs), () => {}),
    resolver.resolve6(host).then(addrs => results.push(...addrs), () => {}),
  ]);
  if (!results.length) throw new Error('No se pudo resolver ' + host);
  return results;
};

export function validateExplorationUrlSync(raw: string, scope: GuardScope): SyncGuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, issue: 'invalid-url' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, issue: 'disallowed-protocol', detail: url.protocol };
  }
  if (url.username || url.password) {
    return { ok: false, issue: 'credentials-in-url' };
  }

  const host = url.hostname;
  if (!host) return { ok: false, issue: 'invalid-url' };

  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIP(literal) !== 0) {
    return { ok: false, issue: 'ip-literal', detail: literal };
  }

  if (!hostAllowed(host, scope.allowedHosts)) {
    return { ok: false, issue: 'host-not-in-allowlist', detail: host };
  }

  const path = url.pathname || '/';
  if (scope.excludedPaths?.length && scope.excludedPaths.some(p => pathMatchesPrefix(path, p))) {
    return { ok: false, issue: 'path-excluded', detail: path };
  }
  if (scope.allowedPaths?.length && !scope.allowedPaths.some(p => pathMatchesPrefix(path, p))) {
    return { ok: false, issue: 'path-not-allowed', detail: path };
  }

  return { ok: true, url };
}

export async function validateExplorationUrl(
  raw: string,
  scope: GuardScope,
  resolver: AddressResolver = defaultResolver,
): Promise<GuardResult> {
  const sync = validateExplorationUrlSync(raw, scope);
  if (!sync.ok) return sync;
  const { url } = sync;

  let addresses: string[];
  try {
    addresses = await resolver(url.hostname);
  } catch (error) {
    return { ok: false, issue: 'dns-failure', detail: error instanceof Error ? error.message : undefined };
  }
  if (!addresses.length) {
    return { ok: false, issue: 'dns-failure', detail: 'sin respuestas' };
  }

  for (const address of addresses) {
    const verdict = classifyAddress(address);
    if (verdict !== 'public') {
      return { ok: false, issue: verdict, detail: address };
    }
  }

  return { ok: true, url, addresses };
}

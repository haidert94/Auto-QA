// Decide si un request del navegador puede continuar o debe abortarse.
// Es la primera línea de defensa dentro del worker Playwright: cada request,
// incluidos los de redirecciones y los subrecursos (imágenes, XHR, iframes),
// pasa por aquí antes de salir a la red.

import type { AddressResolver, GuardIssue, GuardScope } from '../../api/src/exploration/url-guard';
import { validateExplorationUrl } from '../../api/src/exploration/url-guard';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);

const ALLOWED_RESOURCE_TYPES = new Set([
  'document', 'stylesheet', 'script', 'image', 'font',
  'xhr', 'fetch', 'media', 'manifest', 'other',
]);

export type FilterDecision =
  | { allow: true }
  | { allow: false; code: FilterBlockCode; detail?: string };

export type FilterBlockCode =
  | 'method-not-read-only'
  | 'resource-type-blocked'
  | `url-guard-${GuardIssue}`;

export type RequestContext = {
  url: string;
  method: string;
  resourceType: string;
};

export type Cache = Map<string, Promise<CachedResult>>;

type CachedResult =
  | { ok: true }
  | { ok: false; issue: GuardIssue; detail?: string };

export function createCache(): Cache {
  return new Map();
}

export async function decideRequest(
  request: RequestContext,
  scope: GuardScope,
  cache: Cache,
  resolver: AddressResolver,
): Promise<FilterDecision> {
  if (!READ_ONLY_METHODS.has(request.method.toUpperCase())) {
    return { allow: false, code: 'method-not-read-only', detail: request.method };
  }

  if (!ALLOWED_RESOURCE_TYPES.has(request.resourceType)) {
    return { allow: false, code: 'resource-type-blocked', detail: request.resourceType };
  }

  const cached = await getCachedGuard(request.url, scope, cache, resolver);
  if (!cached.ok) {
    return { allow: false, code: ('url-guard-' + cached.issue) as FilterBlockCode, detail: cached.detail };
  }
  return { allow: true };
}

function getCachedGuard(
  url: string,
  scope: GuardScope,
  cache: Cache,
  resolver: AddressResolver,
): Promise<CachedResult> {
  const key = cacheKey(url);
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = runGuard(url, scope, resolver);
  cache.set(key, promise);
  return promise;
}

function cacheKey(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

async function runGuard(url: string, scope: GuardScope, resolver: AddressResolver): Promise<CachedResult> {
  const result = await validateExplorationUrl(url, scope, resolver);
  if (result.ok) return { ok: true };
  return { ok: false, issue: result.issue, detail: result.detail };
}

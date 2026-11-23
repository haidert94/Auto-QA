type JsonObject = Record<string, unknown>;

export type PostmanEndpoint = { path: string; relativeToBase: boolean; hasQuery: boolean };
export type PostmanImport = { endpoints: PostmanEndpoint[]; otherMethods: number; incomplete: number; authenticated: number };

export const postmanFileLimit = 5 * 1024 * 1024;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function usesAuth(auth: unknown, inherited: boolean): boolean {
  const type = object(auth)?.type;
  return typeof type === 'string' ? type.toLowerCase() !== 'noauth' : inherited;
}

function usesAuthHeader(headers: unknown): boolean {
  if (!Array.isArray(headers)) return false;
  return headers.some(value => {
    const header = object(value);
    return header && header.disabled !== true && typeof header.key === 'string' &&
      /^(authorization|proxy-authorization|cookie|x-api-key|api-key)$/i.test(header.key.trim());
  });
}

function endpointFromUrl(value: unknown): PostmanEndpoint | undefined {
  const url = object(value);
  const raw = typeof value === 'string' ? value : typeof url?.raw === 'string' ? url.raw : '';
  const hasQuery = raw.includes('?') || (Array.isArray(url?.query) && url.query.some(entry => object(entry)?.disabled !== true));
  const route = raw.trim().split(/[?#]/, 1)[0];
  let path: string;
  let relativeToBase = false;
  const baseVariable = /^\{\{[^{}]+\}\}(?=\/|$)/.exec(route);
  if (baseVariable) {
    relativeToBase = true;
    path = route.slice(baseVariable[0].length) || '/';
  } else if (route.startsWith('/')) {
    path = route;
  } else if (/^https?:\/\//i.test(route)) {
    try {
      const parsed = new URL(route);
      if (parsed.username || parsed.password) return undefined;
      path = parsed.pathname;
    } catch {
      return undefined;
    }
  } else if (!route && Array.isArray(url?.path) && url.path.every(segment => typeof segment === 'string')) {
    path = '/' + url.path.join('/');
  } else {
    return undefined;
  }
  if (path.startsWith('//') || /[\s\\{}?#]|%7[bd]|(?:^|\/):[^/]+|(?:^|\/)\.{1,2}(?:\/|$)/i.test(path) ||
      path.length > 2048) return undefined;
  return { path, relativeToBase, hasQuery };
}

export function readPostmanCollection(text: string): PostmanImport {
  const collection = object(JSON.parse(text.replace(/^\uFEFF/, '')));
  const schema = object(collection?.info)?.schema;
  if (!collection || typeof schema !== 'string' ||
      !/\/collection\/v2\.[01]\.0\/collection\.json$/i.test(schema) || !Array.isArray(collection.item)) {
    throw new Error('Selecciona una colección de Postman en formato JSON v2.0 o v2.1.');
  }

  const endpoints = new Map<string, PostmanEndpoint>();
  const result: PostmanImport = { endpoints: [], otherMethods: 0, incomplete: 0, authenticated: 0 };
  const pending: Array<{ entries: unknown[]; authenticated: boolean }> = [
    { entries: collection.item, authenticated: usesAuth(collection.auth, false) },
  ];
  for (const { entries, authenticated } of pending) {
    for (const value of entries) {
      const item = object(value);
      if (!item) continue;
      if (Array.isArray(item.item)) {
        pending.push({ entries: item.item, authenticated: usesAuth(item.auth, authenticated) });
        continue;
      }

      const request = object(item.request);
      if (!request || typeof request.method !== 'string') {
        result.incomplete += 1;
      } else if (request.method.toUpperCase() !== 'GET') {
        result.otherMethods += 1;
      } else if (usesAuth(request.auth, authenticated) || usesAuthHeader(request.header)) {
        result.authenticated += 1;
      } else {
        const endpoint = endpointFromUrl(request.url);
        if (!endpoint) {
          result.incomplete += 1;
          continue;
        }
        const key = (endpoint.relativeToBase ? 'relative:' : 'root:') + endpoint.path;
        const previous = endpoints.get(key);
        endpoints.set(key, { ...endpoint, hasQuery: endpoint.hasQuery || !!previous?.hasQuery });
      }
    }
  }
  result.endpoints = [...endpoints.values()];
  return result;
}

export function resolvePostmanEndpoint(endpoint: PostmanEndpoint, baseUrl: string | null): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const base = new URL(baseUrl);
    if ((base.protocol !== 'https:' && base.protocol !== 'http:') || base.username || base.password) return undefined;
    const url = new URL(base.origin);
    const prefix = endpoint.relativeToBase ? base.pathname.replace(/\/+$/, '') : '';
    url.pathname = prefix + endpoint.path;
    return url.href.length <= 2048 ? url.href : undefined;
  } catch {
    return undefined;
  }
}

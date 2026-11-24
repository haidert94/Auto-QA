// Valida un storageState de Playwright antes de guardarlo cifrado. La forma
// es la documentada por BrowserContext.storageState():
//   { cookies: Cookie[], origins: Origin[] }
// No validamos semánticamente (dominios, SameSite estrictos, etc.) — Playwright
// hará eso al consumirlo. Sí validamos tamaños y tipos para evitar que un JSON
// malformado explote al worker, y que un blob arbitrario contamine la columna.
//
// Por seguridad NUNCA se devuelve este objeto al cliente. Solo lo descifra el
// worker justo antes de materializarlo en disco dentro del workdir temporal.

export type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export type PlaywrightOrigin = {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
};

export type PlaywrightStorageState = {
  cookies: PlaywrightCookie[];
  origins: PlaywrightOrigin[];
};

// Tamaño máximo del JSON serializado. 2 MB cubre casos reales con holgura
// (localStorage con tokens JWT, SSR cache, etc.). Por encima de eso el blob
// es sospechoso: PII capturada sin querer, o alguien subiendo lo que no debe.
export const MAX_STORAGE_STATE_BYTES = 2 * 1024 * 1024;
const MAX_COOKIES = 500;
const MAX_ORIGINS = 50;
const MAX_LOCALSTORAGE_ENTRIES = 500;
const MAX_STRING = 8192;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max = MAX_STRING): value is string {
  return typeof value === 'string' && value.length <= max;
}

function validateCookie(raw: unknown, index: number): PlaywrightCookie {
  if (!isPlainObject(raw)) throw new Error(`cookies[${index}]-no-es-objeto`);
  const { name, value, domain, path, expires, httpOnly, secure, sameSite } = raw;
  if (!isBoundedString(name) || !name) throw new Error(`cookies[${index}].name-invalido`);
  if (typeof value !== 'string' || value.length > MAX_STRING) throw new Error(`cookies[${index}].value-invalido`);
  if (!isBoundedString(domain, 253) || !domain) throw new Error(`cookies[${index}].domain-invalido`);
  if (!isBoundedString(path, 2048) || !path) throw new Error(`cookies[${index}].path-invalido`);
  if (expires !== undefined && (typeof expires !== 'number' || !Number.isFinite(expires))) {
    throw new Error(`cookies[${index}].expires-invalido`);
  }
  if (httpOnly !== undefined && typeof httpOnly !== 'boolean') throw new Error(`cookies[${index}].httpOnly-invalido`);
  if (secure !== undefined && typeof secure !== 'boolean') throw new Error(`cookies[${index}].secure-invalido`);
  if (sameSite !== undefined && sameSite !== 'Strict' && sameSite !== 'Lax' && sameSite !== 'None') {
    throw new Error(`cookies[${index}].sameSite-invalido`);
  }
  return {
    name, value, domain, path,
    ...(expires !== undefined && { expires }),
    ...(httpOnly !== undefined && { httpOnly }),
    ...(secure !== undefined && { secure }),
    ...(sameSite !== undefined && { sameSite }),
  };
}

function validateOrigin(raw: unknown, index: number): PlaywrightOrigin {
  if (!isPlainObject(raw)) throw new Error(`origins[${index}]-no-es-objeto`);
  const { origin, localStorage } = raw;
  if (!isBoundedString(origin, 2048) || !origin) throw new Error(`origins[${index}].origin-invalido`);
  try { new URL(origin); } catch { throw new Error(`origins[${index}].origin-no-es-url`); }
  if (!Array.isArray(localStorage)) throw new Error(`origins[${index}].localStorage-no-es-array`);
  if (localStorage.length > MAX_LOCALSTORAGE_ENTRIES) {
    throw new Error(`origins[${index}].localStorage-demasiado-grande`);
  }
  const entries: Array<{ name: string; value: string }> = [];
  for (let j = 0; j < localStorage.length; j++) {
    const entry = localStorage[j];
    if (!isPlainObject(entry)) throw new Error(`origins[${index}].localStorage[${j}]-no-es-objeto`);
    const { name, value } = entry;
    if (!isBoundedString(name) || !name) throw new Error(`origins[${index}].localStorage[${j}].name-invalido`);
    if (typeof value !== 'string' || value.length > MAX_STRING) {
      throw new Error(`origins[${index}].localStorage[${j}].value-invalido`);
    }
    entries.push({ name, value });
  }
  return { origin, localStorage: entries };
}

// Punto de entrada único. Devuelve el storageState normalizado (sin claves
// extra que el input hubiese traído) o lanza con un código corto que el
// controller convierte en BadRequestException. Nunca muta el input.
export function parseStorageState(raw: unknown): PlaywrightStorageState {
  if (!isPlainObject(raw)) throw new Error('storage-state-no-es-objeto');
  const { cookies, origins } = raw;
  if (!Array.isArray(cookies)) throw new Error('cookies-no-es-array');
  if (cookies.length > MAX_COOKIES) throw new Error('cookies-demasiados');
  if (!Array.isArray(origins)) throw new Error('origins-no-es-array');
  if (origins.length > MAX_ORIGINS) throw new Error('origins-demasiados');
  const serialized = JSON.stringify(raw);
  if (serialized.length > MAX_STORAGE_STATE_BYTES) throw new Error('storage-state-demasiado-grande');
  return {
    cookies: cookies.map(validateCookie),
    origins: origins.map(validateOrigin),
  };
}

// Metadatos públicos del storageState: lo único que puede volver al cliente.
// El blob mismo nunca sale del servidor salvo al worker en el momento de ejecutar.
export type StorageStatePublic = {
  label: string | null;
  uploadedAt: string | null;
  expiresAt: string | null;
  cookiesCount: number;
  originsCount: number;
};

export function summarizeStorageState(
  state: PlaywrightStorageState,
  meta: { label: string | null; uploadedAt: Date | null; expiresAt: Date | null },
): StorageStatePublic {
  return {
    label: meta.label,
    uploadedAt: meta.uploadedAt?.toISOString() ?? null,
    expiresAt: meta.expiresAt?.toISOString() ?? null,
    cookiesCount: state.cookies.length,
    originsCount: state.origins.length,
  };
}

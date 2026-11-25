import { BadRequestException } from '@nestjs/common';
import { AccessMode, EnvironmentType } from '@prisma/client';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import { supportsScenarioWrites } from '../runs/environment-policy';
import { matchesScope, normalizeHost, normalizeScopePaths, parseBaseUrl, ScopePath } from './scope';

type OnboardingDto = CreateProjectDto | UpdateProjectDto;

type EnvironmentState = {
  type: EnvironmentType | null;
  baseUrl: string | null;
  accessMode: AccessMode | null;
  authorizationConfirmed: boolean;
  authorizedAt: Date | null;
  allowedHosts: unknown;
  allowedPaths: unknown;
  excludedPaths: unknown;
};

// Limpia el mapa modulesLayout del cliente antes de persistir: solo conserva
// entradas cuyo nombre aparece en priorityModules (así borrar un módulo borra
// su posición) y coordenadas finitas en [0..1]. Devuelve undefined si no
// quedó nada para no persistir un JSON vacío ruidoso.
export function sanitizeModulesLayout(
  raw: unknown,
  priorityModules: string[],
): Record<string, { x: number; y: number }> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const whitelist = new Set(priorityModules);
  const out: Record<string, { x: number; y: number }> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!whitelist.has(name)) continue;
    if (!value || typeof value !== 'object') continue;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    out[name] = { x, y };
  }
  return Object.keys(out).length ? out : undefined;
}

export function strings(values: string[] = []) {
  return [...new Set(values.map(value => value.trim()))];
}

function scopePaths(value: unknown): ScopePath[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ScopePath =>
    !!entry && typeof entry.host === 'string' && typeof entry.path === 'string',
  );
}

export function getMissingRequirements(
  project: { ownerLabel: string | null; ownerId?: string | null },
  environments: EnvironmentState[],
  // El tercer argumento se conserva por compatibilidad con los llamadores:
  // los roles son opt-in, no se exigen ni para acceso privado ni para SSO.
  // Cuando el cliente marca "necesito probar roles" en la UI, el front envía
  // el array; el back lo guarda pero no lo usa como gate del status READY.
  _roles: { permissions: unknown }[] = [],
): string[] {
  const missing: string[] = [];
  if (!project.ownerLabel && !project.ownerId) missing.push('Declara el propietario del proyecto.');
  if (!environments.length) missing.push('Agrega al menos un entorno.');

  environments.forEach((environment, index) => {
    const label = `Entorno ${index + 1}`;
    const allowed = scopePaths(environment.allowedPaths);
    const excluded = scopePaths(environment.excludedPaths);
    const hosts: unknown[] = Array.isArray(environment.allowedHosts) ? environment.allowedHosts : [];
    if (!environment.type) missing.push(`${label}: elige el tipo de entorno.`);
    if (!environment.baseUrl) missing.push(`${label}: registra la URL HTTPS.`);
    if (!environment.accessMode) missing.push(`${label}: elige el modo de acceso.`);
    if (!environment.authorizationConfirmed || !environment.authorizedAt) {
      missing.push(`${label}: confirma la autorización expresa.`);
    }
    if (!hosts.length || hosts.some(host => !allowed.some(entry => entry.host === host))) {
      missing.push(`${label}: define al menos una ruta permitida por dominio.`);
    }
    if (environment.baseUrl && allowed.length) {
      const base = parseBaseUrl(environment.baseUrl);
      if (!matchesScope(base, allowed) || matchesScope(base, excluded)) {
        missing.push(`${label}: la URL base debe quedar dentro del alcance y fuera de las exclusiones.`);
      }
    }
  });
  return missing;
}

function scopeSignature(environment: EnvironmentState & { readOnly: boolean; prohibitedActions: string[] }) {
  return JSON.stringify([
    environment.type, environment.baseUrl, environment.accessMode, environment.readOnly,
    Array.isArray(environment.allowedHosts) ? [...environment.allowedHosts].sort() : [],
    scopePaths(environment.allowedPaths).map(entry => entry.host + entry.path).sort(),
    scopePaths(environment.excludedPaths).map(entry => entry.host + entry.path).sort(),
    [...environment.prohibitedActions].sort(),
  ]);
}

type PreviousEnvironment = Parameters<typeof scopeSignature>[0] & { id: string };

export function prepareOnboarding(
  dto: OnboardingDto,
  previous: { environments: PreviousEnvironment[]; ownerId: string | null } | null,
) {
  const now = new Date();
  const usedIds = new Set<string>();
  const environments = (dto.environments ?? []).map((entry, position) => {
    const old = previous?.environments.find(environment => environment.id === entry.id);
    if (entry.id) {
      if (!old || usedIds.has(entry.id)) {
        throw new BadRequestException('Los identificadores de entorno deben ser únicos y pertenecer al proyecto');
      }
      usedIds.add(entry.id);
    }
    if (entry.readOnly === false && !supportsScenarioWrites(entry.type)) {
      throw new BadRequestException('Los cambios con datos de prueba solo se permiten en Desarrollo, QA o Preproducción.');
    }
    const allowedHosts = [...new Set((entry.allowedHosts ?? []).map(normalizeHost))];
    const baseUrl = entry.baseUrl ? parseBaseUrl(entry.baseUrl).url : null;
    if (entry.authorizationConfirmed && !baseUrl) {
      throw new BadRequestException('Registra una URL antes de confirmar su autorización');
    }
    const data = {
      position,
      type: entry.type ?? null,
      baseUrl,
      accessMode: entry.accessMode ?? null,
      authorizationConfirmed: entry.authorizationConfirmed ?? false,
      authorizedAt: null as Date | null,
      readOnly: entry.readOnly ?? true,
      allowedHosts,
      allowedPaths: normalizeScopePaths(entry.allowedPaths ?? [], allowedHosts),
      excludedPaths: normalizeScopePaths(entry.excludedPaths ?? [], allowedHosts),
      prohibitedActions: strings(entry.prohibitedActions),
      testData: entry.testData && {
        syntheticData: entry.testData.syntheticData?.trim(),
        seeds: entry.testData.seeds?.trim(),
        cleanupStrategy: entry.testData.cleanupStrategy?.trim(),
        integrations: strings(entry.testData.integrations),
      },
      credentials: entry.credentials === undefined
        ? undefined
        : entry.credentials === null
          ? null
          : { user: entry.credentials.user.trim(), password: entry.credentials.password },
    };
    if (data.authorizationConfirmed) {
      data.authorizedAt = old?.authorizationConfirmed && scopeSignature(old) === scopeSignature(data)
        ? old.authorizedAt ?? now
        : now;
    }
    return { id: entry.id, data };
  });

  const names = new Set<string>();
  const roles = (dto.roles ?? []).map(role => {
    const name = role.name.trim();
    const key = name.toLowerCase();
    if (names.has(key)) throw new BadRequestException('Los nombres de los roles deben ser únicos');
    names.add(key);

    const permissionKeys = new Set<string>();
    const permissions = (role.permissions ?? []).map(permission => {
      const resource = permission.resource.trim();
      const action = permission.action.trim();
      const permissionKey = JSON.stringify([resource.toLowerCase(), action.toLowerCase()]);
      if (permissionKeys.has(permissionKey)) {
        throw new BadRequestException('Cada par recurso y acción debe aparecer una vez por rol');
      }
      permissionKeys.add(permissionKey);
      return { resource, action, allowed: permission.allowed };
    });

    return {
      name,
      description: role.description?.trim() ?? null,
      secretReference: role.secretReference ?? null,
      permissions,
    };
  });

  const authorizedDates = environments.map(({ data }) => data.authorizedAt);
  const authorizationConfirmed = authorizedDates.length > 0 && authorizedDates.every(Boolean);
  const priorityModules = strings(dto.priorityModules);
  const project = {
    name: dto.name.trim(),
    description: dto.description?.trim() ?? null,
    ownerLabel: dto.ownerLabel?.trim() ?? null,
    priorityModules,
    modulesLayout: sanitizeModulesLayout(dto.modulesLayout, priorityModules),
    status: dto.status ?? 'DRAFT',
    authorizationConfirmed,
    authorizedAt: authorizationConfirmed
      ? new Date(Math.max(...authorizedDates.map(date => date!.getTime())))
      : null,
  } as const;
  const missing = getMissingRequirements(
    { ...project, ownerId: previous?.ownerId },
    environments.map(({ data }) => data),
    roles,
  );
  if (project.status === 'READY' && missing.length) {
    throw new BadRequestException({ message: missing, statusCode: 400 });
  }
  const settings = dto.executionSettings;
  const executionSettings = settings && {
    browser: settings.browser,
    frequency: settings.frequency?.trim(),
    maxPages: settings.maxPages,
    maxDurationSeconds: settings.maxDurationSeconds,
    maxConcurrency: settings.maxConcurrency,
    requestsPerMinute: settings.requestsPerMinute,
    notifications: settings.notifications?.trim(),
  };
  return { project, executionSettings, environments, roles };
}

import { BadRequestException } from '@nestjs/common';
import { AccessMode, EnvironmentType } from '@prisma/client';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
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
  roles: { permissions: unknown }[],
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

  if (environments.some(environment => environment.accessMode && environment.accessMode !== 'PUBLIC')) {
    if (!roles.length || roles.some(role => !Array.isArray(role.permissions) || !role.permissions.length)) {
      missing.push('El acceso privado o SSO requiere roles con una matriz de permisos.');
    }
  }
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
  const project = {
    name: dto.name.trim(),
    description: dto.description?.trim() ?? null,
    ownerLabel: dto.ownerLabel?.trim() ?? null,
    priorityModules: strings(dto.priorityModules),
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

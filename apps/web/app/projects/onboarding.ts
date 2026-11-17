export const environmentTypes = {
  DEVELOPMENT: 'Desarrollo',
  QA: 'QA',
  STAGING: 'Preproducción',
  PRODUCTION: 'Producción',
};

export const accessModes = {
  PUBLIC: 'Pública',
  PRIVATE: 'Privada',
  SSO: 'Inicio de sesión único (SSO)',
};

export const statusLabels = {
  DRAFT: 'Borrador',
  READY: 'Registro completo',
  ARCHIVED: 'Archivado',
};

export const browserLabels = { CHROMIUM: 'Chromium', FIREFOX: 'Firefox', WEBKIT: 'WebKit' };

export const limitFields = {
  maxPages: 'Páginas por ejecución',
  maxDurationSeconds: 'Duración máxima (segundos)',
  maxConcurrency: 'Ejecuciones concurrentes',
  requestsPerMinute: 'Solicitudes por minuto',
};

type Route = { host: string; path: string };
type Browser = keyof typeof browserLabels;
type Limit = keyof typeof limitFields;
type EnvironmentType = keyof typeof environmentTypes;
type AccessMode = keyof typeof accessModes;

export type Permission = { resource: string; action: string; allowed: boolean };

export type Environment = {
  id: string;
  type: EnvironmentType | null;
  baseUrl: string | null;
  accessMode: AccessMode | null;
  authorizationConfirmed: boolean;
  authorizedAt: string | null;
  allowedHosts: string[];
  allowedPaths: Route[];
  excludedPaths: Route[];
  prohibitedActions: string[];
  readOnly: boolean;
};

export type ProjectSummary = {
  id: string;
  name: string;
  status: keyof typeof statusLabels;
  ownerLabel: string | null;
  environments: Environment[];
};

export type Project = ProjectSummary & {
  description: string | null;
  revision: number;
  priorityModules: string[];
  missingRequirements: string[];
  roles: {
    name: string;
    description: string | null;
    secretReference: string | null;
    permissions: Permission[];
  }[];
  executionSettings: ({
    browser?: Browser;
    frequency?: string;
    notifications?: string;
  } & Partial<Record<Limit, number>>) | null;
};

export type EnvironmentForm = {
  id?: string;
  type: EnvironmentType | '';
  baseUrl: string;
  accessMode: AccessMode | '';
  authorizationConfirmed: boolean;
  authorizedAt?: string | null;
  allowedHosts: string;
  allowedPaths: string;
  excludedPaths: string;
  prohibitedActions: string;
};

export type RoleForm = {
  name: string;
  description: string;
  secretReference: string;
  permissions: Permission[];
};

export type ExecutionForm = {
  browser: Browser | '';
  frequency: string;
  notifications: string;
} & Record<Limit, string>;

export function environmentForm(environment?: Environment): EnvironmentForm {
  return {
    id: environment?.id,
    type: environment?.type ?? '',
    baseUrl: environment?.baseUrl ?? '',
    accessMode: environment?.accessMode ?? '',
    authorizedAt: environment?.authorizedAt,
    authorizationConfirmed: environment?.authorizationConfirmed ?? false,
    allowedHosts: environment?.allowedHosts.join('\n') ?? '',
    allowedPaths: environment?.allowedPaths.map(route => route.host + route.path).join('\n') ?? '',
    excludedPaths: environment?.excludedPaths.map(route => route.host + route.path).join('\n') ?? '',
    prohibitedActions: environment?.prohibitedActions.join('\n') ?? '',
  };
}

export function roleForm(role?: Project['roles'][number]): RoleForm {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    secretReference: role?.secretReference ?? '',
    permissions: role?.permissions ?? [],
  };
}

export function executionForm(settings?: Project['executionSettings']): ExecutionForm {
  return {
    browser: settings?.browser ?? '',
    frequency: settings?.frequency ?? '',
    notifications: settings?.notifications ?? '',
    maxPages: settings?.maxPages?.toString() ?? '',
    maxDurationSeconds: settings?.maxDurationSeconds?.toString() ?? '',
    maxConcurrency: settings?.maxConcurrency?.toString() ?? '',
    requestsPerMinute: settings?.requestsPerMinute?.toString() ?? '',
  };
}

export function lines(value: string) {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function routes(value: string): Route[] {
  return lines(value).map(entry => {
    const separator = entry.indexOf('/');
    return separator > 0
      ? { host: entry.slice(0, separator), path: entry.slice(separator) }
      : { host: entry, path: '' };
  });
}

export function environmentPayload(environment: EnvironmentForm) {
  return {
    id: environment.id,
    type: environment.type || undefined,
    baseUrl: environment.baseUrl.trim() || undefined,
    accessMode: environment.accessMode || undefined,
    authorizationConfirmed: environment.authorizationConfirmed,
    readOnly: true,
    allowedHosts: lines(environment.allowedHosts),
    allowedPaths: routes(environment.allowedPaths),
    excludedPaths: routes(environment.excludedPaths),
    prohibitedActions: lines(environment.prohibitedActions),
  };
}

export const apiProjects = '/api/projects';

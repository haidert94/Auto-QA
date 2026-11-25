import { supportsScenarioWrites } from '../../../api/src/runs/environment-policy';
export { scenarioRunEnvironmentError, supportsScenarioWrites } from '../../../api/src/runs/environment-policy';

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
  credentialUser: string | null;
  hasCredentials: boolean;
  // Metadatos del storageState de Playwright. Si el QA subió un auth.json, el
  // backend expone solo label y fechas — nunca el blob en sí. null = sin sesión.
  storageState: { label: string | null; uploadedAt: string | null; expiresAt: string | null } | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  status: keyof typeof statusLabels;
  ownerLabel: string | null;
  environments: Environment[];
  completedRuns?: number;
  icspSnapshots?: number;
};

export type Project = ProjectSummary & {
  description: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  priorityModules: string[];
  modulesLayout: Record<string, { x: number; y: number }> | null;
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
  readOnly: boolean;
  allowedHosts: string;
  allowedPaths: string;
  excludedPaths: string;
  prohibitedActions: string;
  credentialUser: string;
  credentialPassword: string;
  hasCredentials: boolean;
  clearCredentials: boolean;
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
    readOnly: !supportsScenarioWrites(environment?.type) || environment?.readOnly !== false,
    allowedHosts: environment?.allowedHosts.join('\n') ?? '',
    allowedPaths: environment?.allowedPaths.map(route => route.host + route.path).join('\n') ?? '',
    excludedPaths: environment?.excludedPaths.map(route => route.host + route.path).join('\n') ?? '',
    prohibitedActions: environment?.prohibitedActions.join('\n') ?? '',
    credentialUser: environment?.credentialUser ?? '',
    credentialPassword: '',
    hasCredentials: environment?.hasCredentials ?? false,
    clearCredentials: false,
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
  // credentials:
  //  - undefined   => el backend conserva lo que haya guardado.
  //  - null        => el usuario pidió borrar la credencial.
  //  - { user, password } => se cifra y se guarda.
  // El password NUNCA viaja desde el server al cliente, así que en edit
  // solo se envía cuando el usuario escribió uno nuevo.
  const user = environment.credentialUser.trim();
  const password = environment.credentialPassword;
  const hadCredentials = environment.hasCredentials;
  const privateAccess = environment.accessMode === 'PRIVATE' || environment.accessMode === 'SSO';
  let credentials: { user: string; password: string } | null | undefined;
  if (environment.clearCredentials || !privateAccess) {
    credentials = hadCredentials || environment.clearCredentials ? null : undefined;
  } else if (user && password) {
    credentials = { user, password };
  } else {
    credentials = undefined;
  }
  return {
    id: environment.id,
    type: environment.type || undefined,
    baseUrl: environment.baseUrl.trim() || undefined,
    accessMode: environment.accessMode || undefined,
    authorizationConfirmed: environment.authorizationConfirmed,
    readOnly: !supportsScenarioWrites(environment.type) || environment.readOnly,
    allowedHosts: lines(environment.allowedHosts),
    allowedPaths: routes(environment.allowedPaths),
    excludedPaths: routes(environment.excludedPaths),
    prohibitedActions: lines(environment.prohibitedActions),
    credentials,
  };
}

export const apiProjects = '/api/projects';

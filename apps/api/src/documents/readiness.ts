import type { Environment, FindingKind, Project, TestRole } from '@prisma/client';
import { matchesScope, parseBaseUrl, type ScopePath } from '../projects/scope';
import { isRequirement } from './document-analysis';
import { metadata, type DocumentRecord } from './document-records';

type ReadinessProject = Project & { environments: Environment[]; roles: TestRole[] };

// Hallazgo enriquecido: siempre incluye los IDs necesarios para enlazar la
// evidencia del IPA a la fuente concreta (documento, versión, requisito).
// Los dos puntos de entrada (report() y analyze()) deben construir este
// shape antes de llamar a readiness(); no exponemos la forma antigua.
export type ReadinessFinding = {
  id: string;
  kind: FindingKind;
  pendingConfirmation: boolean;
  text: string;
  locator: string | null;
  documentId: string;
  documentFilename: string;
  versionId: string;
  versionNumber: number;
  requirementId: string | null;
};

export type Anchor = {
  kind: 'environment' | 'document' | 'version' | 'finding' | 'requirement';
  id: string;
  label: string;
  locator?: string | null;
  documentId?: string;
  versionNumber?: number;
};

type Signal = {
  criterion: string;
  weight: number;
  points: number;
  available: string[];
  missing: string[];
  anchors: Anchor[];
  blocking: boolean;
};

function scoped(environment: Environment) {
  function paths(value: unknown): ScopePath[] {
    return Array.isArray(value) ? value.filter(path => path && typeof path.host === 'string' && typeof path.path === 'string') : [];
  }
  const allowed = paths(environment.allowedPaths);
  if (!environment.baseUrl || !Array.isArray(environment.allowedHosts) || !environment.allowedHosts.length ||
      environment.allowedHosts.some(host => !allowed.some(path => path.host === host))) return false;
  try {
    const base = parseBaseUrl(environment.baseUrl);
    return matchesScope(base, allowed) && !matchesScope(base, paths(environment.excludedPaths));
  } catch {
    return false;
  }
}

function envLabel(env: Environment): string {
  const type = env.type ?? 'ENTORNO';
  const base = env.baseUrl ?? env.id.slice(0, 8);
  return `${type} · ${base}`;
}

function envAnchor(env: Environment): Anchor {
  return { kind: 'environment', id: env.id, label: envLabel(env) };
}

export function readiness(project: ReadinessProject, documents: DocumentRecord[], findings: ReadinessFinding[]) {
  const environments = project.environments;
  const hasEnvironments = environments.length > 0;
  const registered = hasEnvironments && environments.every(env => env.type && env.baseUrl) && !!(project.ownerId || project.ownerLabel);
  const authorized = hasEnvironments && environments.every(env => env.authorizationConfirmed && env.authorizedAt);
  const scopeReady = hasEnvironments && environments.every(scoped);
  const publicAccess = hasEnvironments && environments.every(env => env.accessMode === 'PUBLIC');
  const accessKnown = hasEnvironments && environments.every(env => env.accessMode);
  const permissions = project.roles.length > 0 && project.roles.every(role => Array.isArray(role.permissions) && role.permissions.length > 0);
  const references = permissions && project.roles.every(role => role.secretReference);
  const docStates = documents.map(metadata);
  const uploaded = docStates.filter(doc => doc.currentVersion?.uploadedAt).length;
  const processed = docStates.filter(doc => doc.currentVersion?.processedAt).length;
  const validated = docStates.filter(doc => doc.currentVersion?.validatedAt).length;
  const readable = docStates.filter(doc => doc.currentVersion?.processedAt && doc.currentVersion.hasText).length;
  const declared = docStates.filter(doc => doc.state === 'DECLARED').length;
  const verifiable = findings.filter(finding => isRequirement(finding.kind) && !finding.pendingConfirmation).length;
  const ambiguous = findings.filter(finding => isRequirement(finding.kind) && finding.pendingConfirmation).length;
  const data = environments.map(env => env.testData && typeof env.testData === 'object' && !Array.isArray(env.testData) ? env.testData : {});
  const testInputs = hasEnvironments && data.every(item => item.syntheticData || item.seeds);
  const cleanup = hasEnvironments && data.every(item => item.cleanupStrategy);

  // Anclas para trazabilidad: documentos con problemas, requisitos ambiguos,
  // entornos sin alcance definido. No reemplazan los textos available/missing
  // existentes (los tests y la UI vieja los siguen leyendo), se añaden.
  const unauthorizedEnvs = environments.filter(env => !env.authorizationConfirmed || !env.authorizedAt);
  const docAnchors: Anchor[] = docStates
    .filter(doc => !doc.currentVersion?.processedAt || !doc.currentVersion.hasText || !doc.currentVersion.validatedAt)
    .map(doc => ({
      kind: 'document',
      id: doc.id,
      label: doc.filename,
      documentId: doc.id,
      versionNumber: doc.currentVersion?.number,
    }));
  const ambiguousAnchors: Anchor[] = findings
    .filter(f => isRequirement(f.kind) && f.pendingConfirmation)
    .slice(0, 50)
    .map(f => ({
      kind: 'finding',
      id: f.id,
      label: f.text.slice(0, 140),
      locator: f.locator,
      documentId: f.documentId,
      versionNumber: f.versionNumber,
    }));
  const scopeAnchors: Anchor[] = environments.filter(env => !scoped(env)).map(envAnchor);
  const accessAnchors: Anchor[] = environments.filter(env => !env.accessMode).map(envAnchor);

  const signals: Signal[] = [
    {
      criterion: 'Aplicación y autorización', weight: 15, points: (registered ? 5 : 0) + (authorized ? 10 : 0),
      available: [...(registered ? ['Aplicación, propietario y entornos declarados.'] : []),
        ...(authorized ? ['Autorización declarada en todos los entornos.'] : [])],
      missing: [...(registered ? [] : ['Completa el propietario, el tipo y la URL de cada entorno.']),
        ...(authorized ? [] : ['Confirma la autorización expresa de todos los entornos.'])],
      anchors: unauthorizedEnvs.map(envAnchor),
      blocking: !authorized,
    },
    {
      criterion: 'Documentación funcional', weight: 30,
      points: (uploaded ? 5 : 0) + (readable ? 10 : 0) + (verifiable ? 5 : 0) + (validated ? 10 : 0),
      available: ['Documentos cargados: ' + uploaded, 'Documentos procesados: ' + processed,
        'Documentos revisados: ' + validated, 'Requisitos verificables: ' + verifiable],
      missing: [...(uploaded ? [] : ['Adjunta documentación funcional.']),
        ...(readable ? [] : ['Analiza los archivos y aporta versiones con texto legible.']),
        ...(verifiable ? [] : ['Vincula criterios de aceptación explícitos con sus requisitos.']),
        ...(validated ? [] : ['Revisa las fuentes y valida al menos un documento procesado.']),
        ...(ambiguous ? ['Aclara los requisitos marcados como pendientes.'] : [])],
      anchors: [...docAnchors, ...ambiguousAnchors],
      blocking: false,
    },
    {
      criterion: 'Accesos y permisos', weight: publicAccess ? 0 : 20,
      points: publicAccess ? 0 : (accessKnown && permissions ? 15 : 0) + (accessKnown && references ? 5 : 0),
      available: publicAccess ? ['No aplica: todos los entornos son públicos.']
        : [...(permissions ? ['Matriz de permisos declarada.'] : []), ...(references ? ['Referencias de acceso declaradas.'] : [])],
      missing: publicAccess ? [] : [
        ...(accessKnown && permissions ? [] : ['Completa los modos de acceso y la matriz de permisos.']),
        ...(references ? [] : ['Identifica las cuentas de prueba mediante referencias externas.']),
      ],
      anchors: accessAnchors,
      blocking: false,
    },
    {
      criterion: 'Datos y preparación', weight: 20, points: (testInputs ? 10 : 0) + (cleanup ? 10 : 0),
      available: [...(testInputs ? ['Datos sintéticos o semillas declarados.'] : []), ...(cleanup ? ['Limpieza declarada.'] : [])],
      missing: [...(testInputs ? [] : ['Declara datos de prueba o semillas por entorno.']),
        ...(cleanup ? [] : ['Describe la limpieza de los datos de prueba.'])],
      anchors: environments.filter(env => {
        const value = env.testData && typeof env.testData === 'object' && !Array.isArray(env.testData) ? env.testData : {};
        return !(value.syntheticData || value.seeds) || !value.cleanupStrategy;
      }).map(envAnchor),
      blocking: false,
    },
    {
      criterion: 'Alcance y seguridad', weight: 15, points: scopeReady ? 15 : 0,
      available: scopeReady ? ['La URL base de cada entorno queda dentro del alcance declarado.'] : [],
      missing: scopeReady ? [] : ['Define los dominios, las rutas y las exclusiones de cada entorno.'],
      anchors: scopeAnchors,
      blocking: !scopeReady,
    },
  ];

  // Separar bloqueos (fuerzan BLOCKED) de recomendaciones (bajan puntaje).
  const archived = project.status === 'ARCHIVED';
  const blockers: string[] = [];
  if (archived) blockers.push('El proyecto está archivado.');
  if (!authorized) blockers.push('Faltan autorizaciones de entornos.');
  if (!scopeReady) blockers.push('El alcance de los entornos no está completo.');
  const hints = signals.flatMap(signal => signal.blocking ? [] : signal.missing);

  const denominator = signals.reduce((total, signal) => total + signal.weight, 0);
  const score = Math.round(100 * signals.reduce((total, signal) => total + signal.points, 0) / denominator);
  const status = !authorized || !scopeReady || archived ? 'BLOCKED' : 'ASSESSED';

  return {
    score, status, denominator, signals, verifiable, ambiguous,
    documents: { declared, uploaded, processed, validated },
    recommendations: signals.flatMap(signal => signal.missing),
    blockers, hints,
  };
}

export const categoryLabels = {
  AUTO: 'Automática',
  USER_STORY: 'Historias de usuario',
  REQUIREMENTS: 'Requisitos',
  ACCEPTANCE_CRITERIA: 'Criterios de aceptación',
  BUSINESS_RULE: 'Reglas de negocio',
  FLOW: 'Flujos',
  API: 'Especificación de API',
  OTHER: 'Otro',
};

// Tipos de prueba a los que puede aplicar un documento. Un documento sin
// ninguno marcado se considera "General" (sirve a todos los agentes).
export const TEST_TYPE_LABELS = {
  functional_web: 'Funcional web',
  mobile_emulated: 'Mobile emulado',
  compatibility: 'Compatibilidad',
  availability: 'Disponibilidad',
  performance: 'Performance',
  ux: 'UX',
  manual: 'Casos manuales',
} as const;
export type TestTypeCode = keyof typeof TEST_TYPE_LABELS;
export const ALL_TEST_TYPES = Object.keys(TEST_TYPE_LABELS) as TestTypeCode[];

export type Category = keyof typeof categoryLabels;
export type PendingDocument = { id: string; file: File; type: Category; state: 'DECLARED' | 'UPLOADING' | 'ERROR'; error?: string };

type Version = { id: string; number: number; format: string | null; size: number | null; hasText: boolean };
export type SavedDocument = {
  id: string;
  filename: string;
  type: Exclude<Category, 'AUTO'>;
  state: 'DECLARED' | 'UPLOADED' | 'PROCESSED' | 'VALIDATED';
  currentVersion: Version | null;
  versions: Version[];
  classificationSource: 'PENDING' | 'MANUAL' | 'AUTOMATIC';
  testTypes: TestTypeCode[];
  testTypesSource?: 'PENDING' | 'MANUAL' | 'AUTOMATIC';
};

type Source = { version: number; filename: string; locator: string };
export type Report = {
  analysis: null | {
    warnings: string[];
    findings: {
      id: string; kind: string; text: string; pendingConfirmation: boolean; pendingReason?: string | null;
      source: Source; relatedSource: Source | null;
      clarification?: { text: string; criterion: string; filename: string | null; approvedAt: string } | null;
    }[];
  };
  ipa: {
    score: number; status: 'BLOCKED' | 'ASSESSED'; verifiable: number; ambiguous: number;
    documents: { declared: number; uploaded: number; processed: number; validated: number };
    signals: { criterion: string; points: number; weight: number; available: string[]; missing: string[] }[];
    recommendations: string[];
  };
};

export const extensions = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'md', 'json', 'yaml', 'yml'];
export const fileLimit = 5 * 1024 * 1024;

export function fileFormat(name: string) {
  return name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '';
}

export function fileSize(bytes: number | null | undefined) {
  if (bytes == null) return 'Tamaño sin registrar';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MiB';
}

export async function documentRequest<T>(projectId: string, suffix = '', options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/projects/' + projectId + '/documents' + suffix, {
    cache: 'no-store', signal: AbortSignal.timeout(75000), ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    throw new Error(typeof message === 'string' ? message : 'No se pudo completar la operación documental.');
  }
  return response.status === 204 ? undefined as T : response.json();
}

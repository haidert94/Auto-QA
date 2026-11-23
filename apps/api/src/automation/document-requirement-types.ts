import { MAX_FILE_BYTES, parseDocument, type SourceBlock } from '../documents/document-files';
import type { DocumentStorage } from '../documents/document-storage';
import type { Prisma } from '@prisma/client';
import type { DocumentGenerationSources } from './document-generation';

const SPECIALIZED_TYPES = ['mobile_emulated', 'manual'] as const;
type SpecializedType = typeof SPECIALIZED_TYPES[number];
export type DocumentRequirementTypes = Record<string, Partial<Record<SpecializedType, string[]>>>;

function fieldName(value: string) {
  return value.normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

export function requirementTypesInRows(blocks: SourceBlock[]) {
  const mobile = new Set<string>();
  const manual = new Set<string>();
  for (const { fields } of blocks) {
    if (!fields) continue;
    const row = new Map(Object.entries(fields).map(([name, value]) => [fieldName(name), value]));
    const category = fieldName(row.get('categoria') ?? row.get('tipo de prueba') ?? '');
    const key = (row.get('id de historia') ?? row.get('id') ?? row.get('clave') ?? row.get('historia') ?? '')
      .trim().toUpperCase().replace(/\s+/g, '-');
    if (!key || key.length > 80) continue;
    if (['mobile emulado', 'movil emulado', 'mobile emulated'].includes(category)) mobile.add(key);
    if (['casos manuales', 'caso manual', 'pruebas manuales', 'manual'].includes(category)) manual.add(key);
  }
  return {
    ...(mobile.size ? { mobile_emulated: [...mobile] } : {}),
    ...(manual.size ? { manual: [...manual] } : {}),
  };
}

export async function readDocumentRequirementTypes(
  prisma: Prisma.TransactionClient,
  storage: Pick<DocumentStorage, 'get'>,
  sources: DocumentGenerationSources,
): Promise<DocumentRequirementTypes> {
  const ids = [...new Set(SPECIALIZED_TYPES.flatMap(type => (sources[type] ?? []).map(source => source.versionId)))];
  if (!ids.length) return {};
  const versions = await prisma.documentVersion.findMany({
    where: { id: { in: ids }, format: { in: ['XLSX', 'CSV'] }, size: { lte: MAX_FILE_BYTES }, storageKey: { not: null } },
    select: { id: true, format: true, storageKey: true },
  });
  const result: DocumentRequirementTypes = Object.create(null);
  for (let offset = 0; offset < versions.length; offset += 3) {
    await Promise.all(versions.slice(offset, offset + 3).map(async ({ id, format, storageKey }) => {
      if (!format || !storageKey) return;
      try {
        const bytes = await storage.get(storageKey);
        if (!bytes.length || bytes.length > MAX_FILE_BYTES) return;
        const types = requirementTypesInRows(await parseDocument(format, bytes));
        if (Object.keys(types).length) result[id] = types;
      } catch {
        // La generación todavía puede usar el análisis documental confirmado.
      }
    }));
  }
  return result;
}

export function parseDocumentRequirementTypes(value: unknown): DocumentRequirementTypes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: DocumentRequirementTypes = Object.create(null);
  for (const [versionId, candidate] of Object.entries(value)) {
    if (!/^[\w-]{1,80}$/.test(versionId) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    for (const type of SPECIALIZED_TYPES) {
      const keys: unknown = Object.hasOwn(candidate, type) ? (candidate as Record<string, unknown>)[type] : undefined;
      if (Array.isArray(keys)) {
        const valid = keys.filter((key): key is string => typeof key === 'string' && key.length > 0 && key.length <= 80);
        if (valid.length) {
          result[versionId] ??= {};
          result[versionId][type] = valid;
        }
      }
    }
  }
  return result;
}

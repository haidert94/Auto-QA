import type { Prisma } from '@prisma/client';
import { REQUIREMENT_KINDS } from '../documents/document-analysis';
import { documentAnalysisSignature, readDocumentSnapshot } from '../documents/document-records';
import { COMPATIBILITY_SCENARIO_TAGS, MANUAL_SCENARIO_TAG } from '../scenarios/scenario-tags';
import { ALL_TEST_TYPES, isTestType, type AutomationTestType } from './test-types';

type Source = { versionId: string; clarifiedAt: string | null };
export type DocumentGenerationSources = Partial<Record<AutomationTestType, Source[]>>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readGenerationSources(value: unknown): DocumentGenerationSources {
  const sources = object(value);
  const result: DocumentGenerationSources = {};
  for (const type of ALL_TEST_TYPES) {
    const entries = sources[type];
    if (!Array.isArray(entries)) continue;
    result[type] = entries.map(object).flatMap(entry =>
      typeof entry.versionId === 'string'
        ? [{ versionId: entry.versionId, clarifiedAt: typeof entry.clarifiedAt === 'string' ? entry.clarifiedAt : null }]
        : [],
    );
  }
  return result;
}

export function scenarioTestType(tags: string[]): AutomationTestType {
  if (tags.includes(MANUAL_SCENARIO_TAG)) return 'manual';
  if (COMPATIBILITY_SCENARIO_TAGS.some(tag => tags.includes(tag))) return 'compatibility';
  if (tags.includes('@mobile')) return 'mobile_emulated';
  return 'functional_web';
}

export async function documentGenerationScope(tx: Prisma.TransactionClient, projectId: string) {
  const snapshot = await readDocumentSnapshot(tx, projectId);
  const documents = snapshot.flatMap(document => {
    const version = document.versions[0];
    return version?.storageKey && version.uploadedAt && document.testTypes.some(isTestType)
      ? [{ filename: document.filename, testTypes: document.testTypes, versionId: version.id, uploadedAt: version.uploadedAt }]
      : [];
  });
  const empty = { analysisId: null, sources: {} as DocumentGenerationSources, verifiable: 0, ambiguous: 0,
    hasAssignedDocuments: documents.length > 0, hasUnverifiedTypes: false };
  if (!documents.length) return empty;

  const versionIds = documents.map(document => document.versionId);
  const [analysis, jobs, scenarios] = await Promise.all([
    tx.documentAnalysis.findUnique({
      where: { projectId_signature: { projectId, signature: documentAnalysisSignature(snapshot) } },
      select: {
        id: true,
        findings: {
          where: { versionId: { in: versionIds }, kind: { in: REQUIREMENT_KINDS } },
          select: { versionId: true, pendingConfirmation: true, clarification: true,
            requirement: { select: { _count: { select: { criteria: true } } } } },
        },
      },
    }),
    tx.automationJob.findMany({
      where: { projectId, status: 'COMPLETED', stage: 'generated' },
      select: { inputs: true, result: true, createdAt: true },
    }),
    tx.testScenario.findMany({
      where: { projectId, archivedAt: null },
      select: { tags: true, requirement: { select: { sources: {
        where: { versionId: { in: versionIds }, kind: { in: REQUIREMENT_KINDS } },
        select: { versionId: true },
      } } } },
    }),
  ]);
  if (!analysis) return empty;

  const versionsByAnalysis = new Map<string, Set<string>>();
  const oldAnalyses = new Set<string>();
  for (const job of jobs) {
    const inputs = object(job.inputs);
    if (!inputs.documentGenerationSources && typeof inputs.documentAnalysisId === 'string') oldAnalyses.add(inputs.documentAnalysisId);
  }
  if (oldAnalyses.size) {
    const records = await tx.documentAnalysis.findMany({
      where: { projectId, id: { in: [...oldAnalyses] } },
      select: { id: true, versions: { where: { id: { in: versionIds } }, select: { id: true } } },
    });
    for (const record of records) versionsByAnalysis.set(record.id, new Set(record.versions.map(version => version.id)));
  }

  const activeTypes = new Set(scenarios.map(scenario => scenarioTestType(scenario.tags)));
  const caseTypes = new Set(['functional_web', 'mobile_emulated', 'compatibility', 'manual']);
  const worked = new Map<AutomationTestType, Map<string, string>>();
  const remember = (type: AutomationTestType, versionId: string, through: string) => {
    const versions = worked.get(type) ?? new Map<string, string>();
    const previous = versions.get(versionId);
    if (previous === undefined || through > previous) versions.set(versionId, through);
    worked.set(type, versions);
  };
  for (const scenario of scenarios) {
    for (const source of scenario.requirement?.sources ?? []) remember(scenarioTestType(scenario.tags), source.versionId, '');
  }
  for (const job of jobs) {
    const inputs = object(job.inputs);
    const generation = object(object(job.result).generation);
    if (!Array.isArray(generation.outcomes)) continue;
    const saved = readGenerationSources(inputs.documentGenerationSources);
    const analysisVersions = typeof inputs.documentAnalysisId === 'string' ? versionsByAnalysis.get(inputs.documentAnalysisId) : undefined;
    const filenames = new Set(Array.isArray(inputs.documents) ? inputs.documents.map(doc => object(doc).filename) : []);
    for (const value of generation.outcomes) {
      const { type, created, errorCount } = object(value);
      if (typeof type !== 'string' || !isTestType(type) || typeof created !== 'number'
        || (created === 0 && errorCount !== 0)) continue;
      if (created > 0 && caseTypes.has(type) && !activeTypes.has(type)) continue;
      if (inputs.documentGenerationSources) {
        for (const source of saved[type] ?? []) remember(type, source.versionId, source.clarifiedAt ?? '');
        continue;
      }
      // Los trabajos anteriores registraban el análisis o los archivos entregados al revisor.
      for (const document of documents) {
        if (!document.testTypes.includes(type)) continue;
        const belonged = analysisVersions
          ? analysisVersions.has(document.versionId)
          : filenames.has(document.filename) && document.uploadedAt <= job.createdAt;
        if (belonged) remember(type, document.versionId, job.createdAt.toISOString());
      }
    }
  }

  const findingsByVersion = new Map<string, { verified: number; pending: number; clarifiedAt: string | null }>();
  for (const finding of analysis.findings) {
    const totals = findingsByVersion.get(finding.versionId) ?? { verified: 0, pending: 0, clarifiedAt: null };
    if (finding.pendingConfirmation || !finding.requirement?._count.criteria) totals.pending++;
    else totals.verified++;
    const approvedAt = object(finding.clarification).approvedAt;
    if (typeof approvedAt === 'string' && (!totals.clarifiedAt || approvedAt > totals.clarifiedAt)) {
      totals.clarifiedAt = approvedAt;
    }
    findingsByVersion.set(finding.versionId, totals);
  }

  const sources: DocumentGenerationSources = {};
  const pendingVersions = new Set<string>();
  let hasUnverifiedTypes = false;
  for (const type of ALL_TEST_TYPES) {
    const pending = documents.flatMap(({ versionId, testTypes }) => {
      if (!testTypes.includes(type)) return [];
      const clarifiedAt = findingsByVersion.get(versionId)?.clarifiedAt ?? null;
      const covered = worked.get(type)?.get(versionId);
      return covered === undefined || covered < (clarifiedAt ?? '') ? [{ versionId, clarifiedAt }] : [];
    });
    const ready = pending.filter(source => (findingsByVersion.get(source.versionId)?.verified ?? 0) > 0);
    for (const source of ready) pendingVersions.add(source.versionId);
    if (ready.length) sources[type] = ready;
    if (pending.length > ready.length) hasUnverifiedTypes = true;
  }
  let verifiable = 0;
  let ambiguous = 0;
  for (const versionId of pendingVersions) {
    const totals = findingsByVersion.get(versionId)!;
    verifiable += totals.verified;
    ambiguous += totals.pending;
  }
  return { analysisId: analysis.id, sources, verifiable, ambiguous, hasAssignedDocuments: true, hasUnverifiedTypes };
}

import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { type Finding, isRequirement, REQUIREMENT_KINDS } from './document-analysis';

const versionSelect = {
  id: true, number: true, format: true, size: true, uploadedAt: true, processedAt: true, validatedAt: true, hasText: true,
} satisfies Prisma.DocumentVersionSelect;

export const documentSelect = {
  id: true, filename: true, type: true, classificationSource: true, version: true, createdAt: true,
  testTypes: true, testTypesSource: true,
  versions: { orderBy: { number: 'desc' }, select: versionSelect },
} satisfies Prisma.DocumentSelect;

export type DocumentRecord = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;

export function metadata(document: DocumentRecord) {
  const current = document.versions[0];
  const state = current?.validatedAt ? 'VALIDATED'
    : current?.processedAt ? 'PROCESSED' : current?.uploadedAt ? 'UPLOADED' : 'DECLARED';
  return { ...document, state, currentVersion: current ?? null };
}

export function readDocumentSnapshot(tx: Prisma.TransactionClient, projectId: string) {
  return tx.document.findMany({
    where: { projectId, removedAt: null }, orderBy: { id: 'asc' },
    include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
  });
}

export function documentAnalysisSignature(snapshot: Awaited<ReturnType<typeof readDocumentSnapshot>>) {
  const versions = snapshot.map(document => [document.id, document.versions[0]?.id]);
  return createHash('sha256').update(JSON.stringify(['rules-v1', versions])).digest('hex');
}

const sourceSelect = { id: true, number: true, document: { select: { id: true, filename: true } } };

export const analysisSelect = {
  id: true, createdAt: true, warnings: true,
  findings: {
    orderBy: { ordinal: 'asc' },
    select: {
      id: true, kind: true, text: true, pendingConfirmation: true, pendingReason: true, requirementId: true, clarification: true,
      locator: true, relatedLocator: true, version: { select: sourceSelect }, relatedVersion: { select: sourceSelect },
    },
  },
} satisfies Prisma.DocumentAnalysisSelect;

type AnalysisRecord = Prisma.DocumentAnalysisGetPayload<{ select: typeof analysisSelect }>;

export function describeAnalysis(record: AnalysisRecord | null) {
  if (!record) return null;
  return {
    id: record.id, createdAt: record.createdAt, warnings: record.warnings,
    findings: record.findings.map(({ version, locator, relatedVersion, relatedLocator, ...finding }) => ({
      ...finding,
      source: { versionId: version.id, version: version.number, ...version.document, locator },
      relatedSource: relatedVersion
        ? { versionId: relatedVersion.id, version: relatedVersion.number, ...relatedVersion.document, locator: relatedLocator }
        : null,
    })),
  };
}

export async function persistFindings(
  tx: Prisma.TransactionClient,
  projectId: string,
  analysisId: string,
  findings: Finding[],
) {
  const requirementKeys = new Map<string, string>();
  const linkIds = new Map<Finding, { requirementId?: string; criterionId?: string; ruleId?: string }>();

  for (const fact of findings) {
    if (!isRequirement(fact.kind)) continue;
    const requirementId = randomUUID();
    linkIds.set(fact, { requirementId });
    if (fact.key && !requirementKeys.has(fact.key)) requirementKeys.set(fact.key, requirementId);
  }
  await tx.requirement.createMany({
    data: [...linkIds].map(([fact, ids]) => ({
      id: ids.requirementId, projectId, analysisId, kind: fact.kind, externalKey: fact.key, title: fact.text,
    })),
  });

  const criteria: Prisma.AcceptanceCriterionCreateManyInput[] = [];
  const rules: Prisma.BusinessRuleCreateManyInput[] = [];
  for (const fact of findings) {
    if (fact.kind === 'ACCEPTANCE_CRITERION') {
      const criterionId = randomUUID();
      const requirementId = fact.requirementKey && !fact.pendingConfirmation ? requirementKeys.get(fact.requirementKey) : undefined;
      criteria.push({ id: criterionId, analysisId, requirementId, text: fact.text });
      linkIds.set(fact, { criterionId, requirementId });
    }
    if (fact.kind === 'BUSINESS_RULE') {
      const ruleId = randomUUID();
      rules.push({ id: ruleId, analysisId, text: fact.text });
      linkIds.set(fact, { ruleId });
    }
  }
  if (criteria.length) await tx.acceptanceCriterion.createMany({ data: criteria });
  if (rules.length) await tx.businessRule.createMany({ data: rules });
  await tx.requirementTraceability.createMany({
    data: findings.map((fact, ordinal) => ({
      analysisId, ordinal, kind: fact.kind, text: fact.text,
      pendingConfirmation: fact.pendingConfirmation, pendingReason: fact.pendingReason,
      versionId: fact.source.versionId, locator: fact.source.locator,
      relatedVersionId: fact.relatedSource?.versionId, relatedLocator: fact.relatedSource?.locator, ...linkIds.get(fact),
    })),
  });
}

export async function currentScenarioRequirements(tx: Prisma.TransactionClient, projectId: string, includeCoverage = false) {
  const snapshot = await readDocumentSnapshot(tx, projectId);
  return tx.documentAnalysis.findUnique({
    where: { projectId_signature: { projectId, signature: documentAnalysisSignature(snapshot) } },
    select: {
      id: true,
      requirements: {
        where: { sources: { some: { kind: { in: REQUIREMENT_KINDS }, pendingConfirmation: false } } },
        orderBy: { id: 'asc' },
        select: {
          id: true, title: true,
          criteria: { take: 6, orderBy: { id: 'asc' }, select: { text: true } },
          sources: includeCoverage && {
            where: { kind: { in: REQUIREMENT_KINDS }, pendingConfirmation: false },
            select: { versionId: true, clarification: true },
          },
          scenarios: includeCoverage && { where: { archivedAt: null }, select: { tags: true } },
        },
      },
    },
  });
}

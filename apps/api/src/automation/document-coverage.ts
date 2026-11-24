import type { Prisma } from '@prisma/client';
import { REQUIREMENT_KINDS } from '../documents/document-analysis';

type Source = { versionId: string; locator: string; text: string; clarification: Prisma.JsonValue | null };

export function documentCoverageKey({ versionId, locator, text, clarification }: Source) {
  return JSON.stringify([versionId, locator, text, clarification]);
}

export async function readCoveredDocumentSources(
  db: Prisma.TransactionClient, projectId: string, versionIds: string[],
) {
  if (!versionIds.length) return new Set<string>();
  const findings = await db.requirementTraceability.findMany({
    where: {
      analysis: { projectId }, versionId: { in: versionIds },
      kind: { in: REQUIREMENT_KINDS }, pendingConfirmation: false,
      requirement: { is: { projectId, OR: [
        { scenarios: { some: { projectId, archivedAt: null, requirementReviewRequiredAt: null } } },
        { monitors: { some: { projectId } } },
        { performanceAudits: { some: { projectId } } },
        { loadTests: { some: { projectId } } },
        { uxAudits: { some: { projectId } } },
      ] } },
    },
    select: { versionId: true, locator: true, text: true, clarification: true },
  });
  return new Set(findings.map(documentCoverageKey));
}

// Orquesta el pipeline "Automatizar proyecto":
//   Fase A (stage='pending' | 'claimed'):
//     1. convertir docs a Markdown (libs, fallback IA si sale vacío)
//     2. llamar al agente revisor (AiRouter operation document-analysis)
//     3. deja el job en status=COMPLETED stage='review-ready' con el IPA
//   Fase B: la API encola los tipos confirmados en stage='generation-batch-ready'.
//   Fase C: los agentes preparan el lote y el worker lo guarda en una sola transacción.

import type { PrismaClient } from '@prisma/client';
import { convertDocument, needsAiFallback, type ConvertedDocument } from './document-converter';
import { buildReviewPrompt, parseReviewResponse, type ReviewResult } from './review-prompt';
import { currentScenarioRequirements } from '../documents/document-records';
import { summarizeGeneration } from './generation-result';
import { saveGeneratedBatch, type GeneratedCase } from './generated-cases';
import { GENERATION_BATCH_READY } from './generation-stage';
import { currentReadiness } from '../documents/readiness';
import { IPA_AUTOMATION_THRESHOLD } from '../documents/readiness-policy';
import { readGenerationSources, type DocumentGenerationSources } from './document-generation';
import { parseDocumentRequirementTypes, type DocumentRequirementTypes } from './document-requirement-types';
import { runDocumentAgents, runSelectedAgents } from './agents';
import type { AgentContext } from './agents/agent-types';
import { documentCoverageKey, readCoveredDocumentSources } from './document-coverage';
import { isTestType } from './test-types';
import { AiRouter, type AiRouterRequest } from '../ai/ai-router';

export type AutomationClaim = {
  id: string;
  projectId: string;
  inputs: unknown;
  runKey: string | null;
  priorStage: string;
};

type Logger = (level: 'INFO' | 'WARN' | 'ERROR', detail: string) => void;

type InputDoc = { filename: string; base64: string };
type Inputs = {
  url: string;
  description: string | null;
  ownerLabel: string | null;
  documents: InputDoc[];
  selection?: string[];
  documentTestTypesConfirmed: boolean;
  documentAnalysisId?: string;
  documentGenerationSources?: DocumentGenerationSources;
  documentRequirementTypes: DocumentRequirementTypes;
};

function readInputs(raw: unknown): Inputs {
  const safe = (raw ?? {}) as Partial<Inputs> & { documentTestTypes?: unknown };
  return {
    url: typeof safe.url === 'string' ? safe.url : '',
    description: typeof safe.description === 'string' ? safe.description : null,
    ownerLabel: typeof safe.ownerLabel === 'string' ? safe.ownerLabel : null,
    documents: Array.isArray(safe.documents)
      ? safe.documents.filter(d => d && typeof d.filename === 'string' && typeof d.base64 === 'string')
      : [],
    selection: Array.isArray(safe.selection) ? safe.selection.filter(s => typeof s === 'string') : undefined,
    documentTestTypesConfirmed: Array.isArray(safe.documentTestTypes),
    documentAnalysisId: typeof safe.documentAnalysisId === 'string' ? safe.documentAnalysisId : undefined,
    documentGenerationSources: safe.documentGenerationSources ? readGenerationSources(safe.documentGenerationSources) : undefined,
    documentRequirementTypes: parseDocumentRequirementTypes(safe.documentRequirementTypes),
  };
}

export async function runAutomation(
  prisma: PrismaClient, claim: AutomationClaim, router: AiRouter, log: Logger = () => {},
): Promise<void> {
  const inputs = readInputs(claim.inputs);
  const project = await prisma.project.findUnique({
    where: { id: claim.projectId },
    select: { name: true, organizationId: true, environments: { take: 1, select: { id: true } } },
  });
  if (!project) {
    await fail(prisma, claim, 'project-missing');
    return;
  }

  try {
    if (claim.priorStage === GENERATION_BATCH_READY || claim.priorStage === 'selection-done') {
      await runGenerationPhase(prisma, claim, router, project, inputs, log);
    } else {
      await runReviewPhase(prisma, claim, router, project, inputs, log);
    }
  } catch (error) {
    log('ERROR', 'automation-crashed: ' + (error instanceof Error ? error.message : String(error)));
    await fail(prisma, claim, 'automation-crashed');
  }
}

async function runReviewPhase(
  prisma: PrismaClient, claim: AutomationClaim, router: AiRouter,
  project: { name: string; organizationId: string | null },
  inputs: Inputs, log: Logger,
): Promise<void> {
  await setStage(prisma, claim.id, 'converting');
  const converted: ConvertedDocument[] = [];
  for (const doc of inputs.documents) {
    const bytes = Buffer.from(doc.base64, 'base64');
    const result = await convertDocument({ filename: doc.filename, bytes });
    converted.push(result);
    if (needsAiFallback(result)) {
      log('WARN', 'conversion vacía para ' + doc.filename + '; IA fallback pendiente de implementar');
    }
  }
  await mergeStep(prisma, claim.id, 'converting', {
    count: converted.length,
    byFile: converted.map(c => ({ filename: c.filename, chars: c.markdown.length, warnings: c.warnings })),
  });

  await setStage(prisma, claim.id, 'reviewing');
  const prompt = buildReviewPrompt({
    projectName: project.name,
    baseUrl: inputs.url,
    description: inputs.description,
    documents: converted.map(c => ({ filename: c.filename, markdown: c.markdown })),
  });
  const request: AiRouterRequest = {
    operation: 'document-analysis',
    organizationId: project.organizationId,
    projectId: claim.projectId,
    runKey: claim.runKey,
    prompt,
    systemPrompt: 'Eres un ingeniero QA senior. Responde SOLO con JSON válido.',
    maxOutputTokens: 4096,
  };
  const aiResponse = await router.dispatch(request);
  const review: ReviewResult = parseReviewResponse(aiResponse.text);
  await mergeStep(prisma, claim.id, 'reviewing', {
    model: aiResponse.model, usedFallback: aiResponse.usedFallback ?? false,
    inputTokens: aiResponse.inputTokens, outputTokens: aiResponse.outputTokens,
  });

  await prisma.automationJob.update({
    where: { id: claim.id },
    data: {
      status: 'COMPLETED', stage: 'review-ready', completedAt: new Date(),
      result: {
        review,
        documents: converted.map(c => ({ filename: c.filename, chars: c.markdown.length, warnings: c.warnings })),
        aiModel: aiResponse.model, usedFallback: aiResponse.usedFallback ?? false,
      } as never,
    },
  });
  log('INFO', 'review ready · score=' + review.score + ' nivel=' + review.level);
}

async function runGenerationPhase(
  prisma: PrismaClient, claim: AutomationClaim, router: AiRouter,
  project: { name: string; organizationId: string | null; environments: Array<{ id: string }> },
  inputs: Inputs, log: Logger,
): Promise<void> {
  await setStage(prisma, claim.id, 'generating');
  const selection = inputs.selection ?? [];
  if (!selection.length) {
    await fail(prisma, claim, 'selection-empty');
    return;
  }

  // Recupera el review guardado en Fase A para darle contexto a los agentes.
  const previous = await prisma.automationJob.findUnique({
    where: { id: claim.id }, select: { result: true },
  });
  const { ipa, analysis: current } = await currentReadiness(prisma, claim.projectId);
  if (!current || ipa.status !== 'ASSESSED' || ipa.score < IPA_AUTOMATION_THRESHOLD) {
    await fail(prisma, claim, 'ipa-traceability-blocked');
    return;
  }
  const analysis = await currentScenarioRequirements(prisma, claim.projectId, true);
  if (!analysis?.requirements.length || analysis.id !== current.id
    || (inputs.documentAnalysisId && analysis.id !== inputs.documentAnalysisId)) {
    await fail(prisma, claim, 'document-analysis-changed');
    return;
  }

  const review = inputs.documentTestTypesConfirmed ? { stories: [] }
    : (previous?.result as { review?: ReviewResult } | null)?.review ?? { stories: [] };
  const requirements = analysis.requirements.map(requirement => ({
    ...requirement,
    documentVersionIds: requirement.sources.map(source => source.versionId),
    clarified: requirement.sources.some(source => !!source.clarification),
  })).sort((a, b) => Number(b.clarified) - Number(a.clarified));
  const scopedVersionIds = [...new Set(inputs.documentGenerationSources
    ? selection.filter(isTestType).flatMap(type => inputs.documentGenerationSources?.[type]?.map(source => source.versionId) ?? [])
    : requirements.flatMap(requirement => requirement.documentVersionIds))];
  const coveredSources = inputs.documentTestTypesConfirmed
    ? await readCoveredDocumentSources(prisma, claim.projectId, scopedVersionIds)
    : new Set<string>();

  const environmentId = project.environments[0]?.id ?? null;
  const batch: GeneratedCase[] = [];
  const context: AgentContext = {
    projectId: claim.projectId,
    organizationId: project.organizationId,
    jobId: claim.id,
    runKey: claim.runKey,
    environmentId,
    url: inputs.url,
    description: inputs.description,
    review,
    requirements: requirements.map(requirement => ({
      ...requirement,
      covered: requirement.sources.some(source => coveredSources.has(documentCoverageKey(source))),
    })),
    documentTestTypesConfirmed: inputs.documentTestTypesConfirmed,
    documentGenerationSources: inputs.documentGenerationSources,
    documentRequirementTypes: inputs.documentRequirementTypes,
  };
  const deps = { prisma, router, batch };
  const documentBatch = inputs.documentTestTypesConfirmed ? await runDocumentAgents(selection, context, deps) : null;
  const outcomes = documentBatch?.outcomes ?? await runSelectedAgents(selection, context, deps);

  await mergeStep(prisma, claim.id, 'generating', {
    outcomes: outcomes.map(o => ({ type: o.type, prepared: o.created, usedFallback: o.usedFallback, model: o.model, errors: o.errors.slice(0, 5) })),
  });

  const generation = summarizeGeneration(outcomes);
  const result = {
    ...(previous?.result as Record<string, unknown> ?? {}),
    generation: { selection, ...generation, ...(documentBatch && { coverage: documentBatch.coverage }) },
  };
  const incompleteTypes = (documentBatch?.requiredTypes ?? selection).some(type => !outcomes.some(outcome => outcome.type === type && outcome.created > 0));
  if (incompleteTypes || documentBatch?.coverage.missing.length) {
    const errorCode = batch.length ? 'generation-incomplete' : 'generation-empty';
    await prisma.automationJob.update({
      where: { id: claim.id, stage: 'generating' },
      data: {
        status: 'FAILED', errorCode, completedAt: new Date(),
        result: { ...result, generation: {
          ...result.generation, totalCreated: 0, outcomes: generation.outcomes.map(outcome => ({ ...outcome, created: 0 })),
        } } as never,
      },
    });
    log('WARN', errorCode + ' · ' + outcomes.map(outcome => outcome.type + '=' + outcome.created).join(' '));
    return;
  }

  try {
    const published = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${claim.projectId} FOR UPDATE`;
      const latest = await currentReadiness(tx, claim.projectId);
      if (latest.analysis?.id !== analysis.id || latest.ipa.status !== 'ASSESSED' || latest.ipa.score < IPA_AUTOMATION_THRESHOLD) {
        await tx.automationJob.update({
          where: { id: claim.id, stage: 'generating' },
          data: { status: 'FAILED', errorCode: 'document-analysis-changed', completedAt: new Date() },
        });
        return false;
      }
      if (documentBatch) {
        const stagedIds = new Set(batch.map(candidate => candidate.data.requirementId));
        const latestCoverage = await readCoveredDocumentSources(tx, claim.projectId, scopedVersionIds);
        const scopedIds = new Set(documentBatch.scopedRequirements.map(requirement => requirement.id));
        const lost = requirements.filter(requirement => scopedIds.has(requirement.id) && !stagedIds.has(requirement.id)
          && !requirement.sources.some(source => latestCoverage.has(documentCoverageKey(source))));
        if (lost.length) {
          await tx.automationJob.update({
            where: { id: claim.id, stage: 'generating' },
            data: {
              status: 'FAILED', errorCode: 'generation-coverage-changed', completedAt: new Date(),
              result: { ...result, generation: { ...result.generation, totalCreated: 0,
                outcomes: generation.outcomes.map(outcome => ({ ...outcome, created: 0 })),
                coverage: { total: documentBatch.coverage.total, missing: lost.map(({ id, title, externalKey }) =>
                  ({ id, title, externalKey, issue: 'coverage-changed' })) },
              } } as never,
            },
          });
          return false;
        }
      }
      await saveGeneratedBatch(tx, claim.projectId, batch, requirements);
      await tx.automationJob.update({
        where: { id: claim.id, stage: 'generating' },
        data: { status: 'COMPLETED', stage: 'generated', errorCode: null, completedAt: new Date(), result: result as never },
      });
      return true;
    }, { timeout: 15000 });
    if (published) log('INFO', 'generated · ' + outcomes.map(outcome => outcome.type + '=' + outcome.created).join(' '));
  } catch (error) {
    log('ERROR', 'generation-save-failed: ' + (error instanceof Error ? error.name : 'unknown'));
    await prisma.automationJob.updateMany({
      where: { id: claim.id, stage: 'generating' },
      data: { status: 'FAILED', errorCode: 'generation-save-failed', completedAt: new Date() },
    });
  }
}

async function setStage(prisma: PrismaClient, jobId: string, stage: string): Promise<void> {
  await prisma.automationJob.update({ where: { id: jobId }, data: { stage } });
}

async function mergeStep(prisma: PrismaClient, jobId: string, key: string, data: Record<string, unknown>): Promise<void> {
  const current = await prisma.automationJob.findUnique({ where: { id: jobId }, select: { steps: true } });
  const steps = (current?.steps ?? {}) as Record<string, unknown>;
  steps[key] = { ...data, at: new Date().toISOString() };
  await prisma.automationJob.update({ where: { id: jobId }, data: { steps: steps as never } });
}

async function fail(prisma: PrismaClient, claim: AutomationClaim, code: string): Promise<void> {
  await prisma.automationJob.update({
    where: { id: claim.id },
    data: { status: 'FAILED', completedAt: new Date(), errorCode: code },
  }).catch(() => {});
}

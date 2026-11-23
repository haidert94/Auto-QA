// Orquesta el pipeline "Automatizar proyecto":
//   Fase A (stage='pending' | 'claimed'):
//     1. convertir docs a Markdown (libs, fallback IA si sale vacío)
//     2. llamar al agente revisor (AiRouter operation document-analysis)
//     3. deja el job en status=COMPLETED stage='review-ready' con el IPA
//   Fase B: el cliente escoge tipos vía API -> stage='selection-done'
//   Fase C (stage='selection-done'):
//     4. ejecuta en paralelo los agentes de generación seleccionados
//     5. deja el job en status=COMPLETED stage='generated' con el resumen
//
// Un mismo registro AutomationJob puede ser reclamado dos veces por el
// worker: primero con stage='pending' y luego con stage='selection-done'.

import type { PrismaClient } from '@prisma/client';
import { convertDocument, needsAiFallback, type ConvertedDocument } from './document-converter';
import { buildReviewPrompt, parseReviewResponse, type ReviewResult } from './review-prompt';
import { currentScenarioRequirements, documentAnalysisSignature, readDocumentSnapshot } from '../documents/document-records';
import { readGenerationSources, type DocumentGenerationSources } from './document-generation';
import { runSelectedAgents } from './agents';
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
    if (claim.priorStage === 'selection-done') {
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
  const analysis = inputs.documentTestTypesConfirmed
    ? await currentScenarioRequirements(prisma, claim.projectId, true)
    : null;
  if (inputs.documentTestTypesConfirmed && (!analysis?.requirements.length
    || (inputs.documentAnalysisId && analysis.id !== inputs.documentAnalysisId))) {
    await fail(prisma, claim, 'document-analysis-changed');
    return;
  }

  const review = analysis ? { stories: [] } : (previous?.result as { review?: ReviewResult } | null)?.review;
  if (!review) {
    await fail(prisma, claim, 'review-missing');
    return;
  }

  const prioritized = analysis?.requirements.map(requirement => ({
    ...requirement,
    documentVersionIds: requirement.sources.map(source => source.versionId),
    clarified: requirement.sources.some(source => !!source.clarification),
  })).sort((a, b) => Number(b.clarified) - Number(a.clarified));
  const requirements = prioritized ?? (selection.some(type => ['functional_web', 'mobile_emulated', 'manual'].includes(type))
    ? await readScenarioRequirements(prisma, claim.projectId)
    : []);
  const environmentId = project.environments[0]?.id ?? null;
  const outcomes = await runSelectedAgents(selection, {
    projectId: claim.projectId,
    organizationId: project.organizationId,
    jobId: claim.id,
    runKey: claim.runKey,
    environmentId,
    url: inputs.url,
    description: inputs.description,
    review,
    requirements,
    documentTestTypesConfirmed: inputs.documentTestTypesConfirmed,
    documentGenerationSources: inputs.documentGenerationSources,
  }, { prisma, router });

  await mergeStep(prisma, claim.id, 'generating', {
    outcomes: outcomes.map(o => ({ type: o.type, created: o.created, usedFallback: o.usedFallback, model: o.model, errors: o.errors.slice(0, 5) })),
  });

  await prisma.automationJob.update({
    where: { id: claim.id },
    data: {
      status: 'COMPLETED', stage: 'generated', completedAt: new Date(),
      result: {
        ...(previous?.result as Record<string, unknown> ?? {}),
        generation: {
          selection,
          outcomes: outcomes.map(o => ({ type: o.type, created: o.created, usedFallback: o.usedFallback, model: o.model, errorCount: o.errors.length })),
          totalCreated: outcomes.reduce((n, o) => n + o.created, 0),
        },
      } as never,
    },
  });
  log('INFO', 'generated · ' + outcomes.map(o => o.type + '=' + o.created).join(' '));
}

async function readScenarioRequirements(prisma: PrismaClient, projectId: string) {
  const snapshot = await readDocumentSnapshot(prisma, projectId);
  if (!snapshot.length) return [];
  const analysis = await prisma.documentAnalysis.findUnique({
    where: { projectId_signature: { projectId, signature: documentAnalysisSignature(snapshot) } },
    select: { requirements: {
      take: 20, orderBy: { id: 'asc' },
      select: { id: true, title: true, criteria: { take: 4, orderBy: { id: 'asc' }, select: { text: true } } },
    } },
  });
  return analysis?.requirements ?? [];
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

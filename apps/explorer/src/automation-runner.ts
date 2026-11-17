// Orquesta el pipeline "Automatizar proyecto":
//   1. convertir docs a Markdown (libs, fallback IA si sale vacío)
//   2. llamar al agente revisor (AiRouter operation document-analysis)
//   3. guardar el IPA y pasar a status AWAITING_SELECTION (fase B)
// La selección de pruebas y la generación de casos (fase C) quedan para
// commits siguientes; aquí dejamos la pipeline parando limpia después
// del revisor.

import type { PrismaClient } from '@prisma/client';
import { convertDocument, needsAiFallback, type ConvertedDocument } from '../../api/src/automation/document-converter';
import { buildReviewPrompt, parseReviewResponse, type ReviewResult } from '../../api/src/automation/review-prompt';
import { AiRouter, type AiRouterRequest } from '../../api/src/ai/ai-router';

export type AutomationClaim = {
  id: string;
  projectId: string;
  inputs: unknown;
  runKey: string | null;
};

type Logger = (level: 'INFO' | 'WARN' | 'ERROR', detail: string) => void;

type InputDoc = { filename: string; base64: string };
type Inputs = {
  url: string;
  description: string | null;
  ownerLabel: string | null;
  documents: InputDoc[];
};

function readInputs(raw: unknown): Inputs {
  const safe = (raw ?? {}) as Partial<Inputs> & { documents?: InputDoc[] };
  return {
    url: typeof safe.url === 'string' ? safe.url : '',
    description: typeof safe.description === 'string' ? safe.description : null,
    ownerLabel: typeof safe.ownerLabel === 'string' ? safe.ownerLabel : null,
    documents: Array.isArray(safe.documents)
      ? safe.documents.filter(d => d && typeof d.filename === 'string' && typeof d.base64 === 'string')
      : [],
  };
}

export async function runAutomation(
  prisma: PrismaClient, claim: AutomationClaim, router: AiRouter, log: Logger = () => {},
): Promise<void> {
  const inputs = readInputs(claim.inputs);
  const project = await prisma.project.findUnique({
    where: { id: claim.projectId }, select: { name: true, organizationId: true },
  });
  if (!project) {
    await fail(prisma, claim, 'project-missing');
    return;
  }

  try {
    // Paso 1: convertir
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

    // Paso 2: revisar con IA
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
      model: aiResponse.model,
      usedFallback: aiResponse.usedFallback ?? false,
      inputTokens: aiResponse.inputTokens,
      outputTokens: aiResponse.outputTokens,
    });

    // Resultado final del commit A: deja el job en status COMPLETED con
    // el IPA y los documentos convertidos en `result`. El commit B añade
    // un paso "await-selection" que lo deja en RUNNING esperando al
    // cliente.
    await prisma.automationJob.update({
      where: { id: claim.id },
      data: {
        status: 'COMPLETED',
        stage: 'review-ready',
        completedAt: new Date(),
        result: {
          review,
          documents: converted.map(c => ({ filename: c.filename, chars: c.markdown.length, warnings: c.warnings })),
          aiModel: aiResponse.model,
          usedFallback: aiResponse.usedFallback ?? false,
        } as never,
      },
    });
    log('INFO', 'review ready · score=' + review.score + ' nivel=' + review.level);
  } catch (error) {
    log('ERROR', 'automation-crashed: ' + (error instanceof Error ? error.message : String(error)));
    await fail(prisma, claim, 'automation-crashed');
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

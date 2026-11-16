// Enruta una operación IA al proveedor correcto según el plan de la
// organización y el entorno disponible. Si el plan incluye IA pero las
// credenciales no están configuradas, cae al RuleBasedProvider con
// usedFallback=true para que el caller lo sepa.

import { Injectable } from '@nestjs/common';
import type { CapabilityCode } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AiModel, AiOperation, AiProvider, AiRequest, AiResponse } from './ai-provider';
import { BudgetService } from './budget.service';
import { ClaudeProvider } from './claude-provider';
import { OpenAiProvider } from './openai-provider';
import { RuleBasedProvider } from './rule-based-provider';

// Capability requerida por cada operación. Si la org no la tiene en su
// plan, el router responde con el fallback sin consumir.
const CAPABILITY_FOR_OPERATION: Record<AiOperation, CapabilityCode | null> = {
  'document-analysis': 'AI_DOCUMENT_ANALYSIS',
  'document-classification': 'AI_DOCUMENT_ANALYSIS',
  'scenario-generation': 'AI_SCENARIO_GENERATION',
  'failure-explanation': 'AI_FAILURE_EXPLANATION',
};

// Mapeo de capability → modelo por defecto. Se puede sobre-escribir con
// AUTOQA_AI_DEFAULT_MODEL o por plan en una iteración futura.
function defaultModel(): AiModel {
  const env = process.env.AUTOQA_AI_DEFAULT_MODEL;
  if (env === 'claude-haiku-4-5' || env === 'claude-sonnet-4-5' ||
      env === 'gpt-4o' || env === 'gpt-4o-mini') return env;
  return 'claude-sonnet-4-5';
}

export type AiRouterRequest = AiRequest & {
  organizationId: string | null;
  projectId: string | null;
  runKey: string | null;
};

@Injectable()
export class AiRouter {
  private readonly fallback = new RuleBasedProvider();

  constructor(private readonly prisma: PrismaService, private readonly budget: BudgetService) {}

  async dispatch(request: AiRouterRequest): Promise<AiResponse> {
    const capability = CAPABILITY_FOR_OPERATION[request.operation];
    if (!request.organizationId) {
      // Modo legacy sin suscripción: no se cobra IA, se usa el fallback.
      return this.fallback.complete(request);
    }
    if (capability && !(await this.planHasCapability(request.organizationId, capability))) {
      return this.fallback.complete(request);
    }

    const estimatedTokens = (request.prompt.length / 4) + (request.maxOutputTokens ?? 2048);
    try { await this.budget.ensureBudget(request.organizationId, Math.ceil(estimatedTokens)); }
    catch { return this.fallback.complete(request); }

    const provider = this.providerFor(defaultModel());
    if (!provider.isConfigured) return this.fallback.complete(request);

    try {
      const response = await provider.complete(request);
      await this.budget.recordConsumption(
        request.organizationId, request.projectId, request.operation, response, request.runKey,
      );
      return response;
    } catch {
      // Error de red o 5xx del proveedor: no cobramos, devolvemos fallback.
      return this.fallback.complete(request);
    }
  }

  private providerFor(model: AiModel): AiProvider {
    switch (model) {
      case 'claude-haiku-4-5':
      case 'claude-sonnet-4-5':
        return new ClaudeProvider(model);
      case 'gpt-4o':
      case 'gpt-4o-mini':
        return new OpenAiProvider(model);
      default:
        return this.fallback;
    }
  }

  private async planHasCapability(organizationId: string, capability: CapabilityCode): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: { include: { capabilities: true } } },
    });
    const cap = subscription?.plan?.capabilities?.find(c => c.code === capability);
    return !!cap && cap.availability !== 'NOT_INCLUDED';
  }
}

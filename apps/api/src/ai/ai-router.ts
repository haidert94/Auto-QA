// Enruta una operación IA al proveedor correcto según el plan de la
// organización y el entorno disponible. Elige modelo por operación
// (Haiku para tareas simples, Sonnet para razonamiento), con cascada
// de fallback: modelo primario → equivalente del otro proveedor →
// rule-based.

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
  'ux-analysis': 'UX_ANALYSIS',
};

// Modelo por operación. Justificación en docs/AI.md:
// - Clasificación y explicación de fallos: Haiku (cost-eficiente).
// - Análisis documental y generación de escenarios: Sonnet (razonamiento).
// Haiku para las operaciones baratas (clasificación, explicación, análisis
// documental: Fase A de Automatizar aceptó 62/100 con Haiku sin problemas).
// Sonnet para las que exigen razonamiento (generación de escenarios con
// pasos actor/acción/validación, análisis UX con heurísticas Nielsen).
const MODEL_BY_OPERATION: Record<AiOperation, AiModel> = {
  'document-classification': 'claude-haiku-5-5',
  'failure-explanation': 'claude-haiku-5-5',
  'document-analysis': 'claude-haiku-5-5',
  'scenario-generation': 'claude-sonnet-5-5',
  'ux-analysis': 'claude-sonnet-5-5',
};

// Env var opcional por operación para experimentar sin recompilar.
const ENV_OVERRIDE: Record<AiOperation, string> = {
  'document-classification': 'AUTOQA_AI_MODEL_CLASSIFY',
  'failure-explanation': 'AUTOQA_AI_MODEL_EXPLAIN',
  'document-analysis': 'AUTOQA_AI_MODEL_ANALYZE',
  'scenario-generation': 'AUTOQA_AI_MODEL_SUGGEST',
  'ux-analysis': 'AUTOQA_AI_MODEL_UX',
};

// Equivalencias para fallback entre proveedores. Si Anthropic cae, el
// router intenta con el equivalente de OpenAI y viceversa. Mantiene el
// mismo rango de calidad (Haiku ↔ mini, Sonnet ↔ gpt-4o).
const ALTERNATIVE_MODEL: Record<AiModel, AiModel | null> = {
  'claude-haiku-5-5':  'gpt-4o-mini',
  'claude-sonnet-5-5': 'gpt-4o',
  'gpt-4o-mini':       'claude-haiku-5-5',
  'gpt-4o':            'claude-sonnet-5-5',
  'rule-based':        null,
};

const VALID_MODELS: AiModel[] = [
  'claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-4o', 'gpt-4o-mini',
];

function isValidModel(value: string | undefined): value is AiModel {
  return !!value && (VALID_MODELS as string[]).includes(value);
}

function defaultModel(): AiModel {
  const env = process.env.AUTOQA_AI_DEFAULT_MODEL;
  return isValidModel(env) ? env : 'claude-sonnet-5-5';
}

export function modelForOperation(operation: AiOperation): AiModel {
  const envValue = process.env[ENV_OVERRIDE[operation]];
  if (isValidModel(envValue)) return envValue;
  return MODEL_BY_OPERATION[operation] ?? defaultModel();
}

export type AiRouterRequest = AiRequest & {
  organizationId: string | null;
  projectId: string | null;
  runKey: string | null;
};

@Injectable()
export class AiRouter {
  private readonly fallback = new RuleBasedProvider();
  // Logger temporal para diagnosticar por qué una operación cae al
  // rule-based. Al cerrar la validación, se puede dejar a nivel debug
  // en vez de log para no inflar los runtime logs.
  private readonly logger = new Logger(AiRouter.name);

  constructor(private readonly prisma: PrismaService, private readonly budget: BudgetService) {}

  async dispatch(request: AiRouterRequest): Promise<AiResponse> {
    const capability = CAPABILITY_FOR_OPERATION[request.operation];
    const tag = `${request.operation}:${request.projectId ?? 'no-project'}`;
    if (!request.organizationId) {
      this.logger.log(`[router] ${tag} fallback: sin organizationId`);
      return this.fallback.complete(request);
    }
    if (capability && !(await this.planHasCapability(request.organizationId, capability))) {
      this.logger.log(`[router] ${tag} fallback: plan no incluye ${capability}`);
      return this.fallback.complete(request);
    }

    const estimatedTokens = Math.ceil((request.prompt.length / 4) + (request.maxOutputTokens ?? 2048));
    try { await this.budget.ensureBudget(request.organizationId, estimatedTokens); }
    catch (error) {
      const fallback = await this.fallback.complete(request);
      if (error instanceof ForbiddenException) {
        this.logger.log(`[router] ${tag} fallback: presupuesto mensual insuficiente`);
        return { ...fallback, fallbackReason: 'ai-budget-exhausted' };
      }
      this.logger.warn(`[router] ${tag} fallback: no se pudo consultar el presupuesto de IA`);
      return fallback;
    }

    const primary = modelForOperation(request.operation);
    for (const provider of this.providerCascade(primary)) {
      if (!provider.isConfigured) {
        this.logger.log(`[router] ${tag} skip ${provider.model}: no configurado`);
        continue;
      }
      try {
        const response = await provider.complete(request);
        this.logger.log(`[router] ${tag} OK via ${response.model} (in=${response.inputTokens} out=${response.outputTokens})`);
        await this.budget.recordConsumption(
          request.organizationId, request.projectId, request.operation, response, request.runKey,
        );
        return response;
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        this.logger.warn(`[router] ${tag} ${provider.model} falló: ${detail.slice(0, 200)}`);
      }
    }
    this.logger.log(`[router] ${tag} fallback final: ningún proveedor respondió`);
    return this.fallback.complete(request);
  }

  // Devuelve proveedores en orden: primario → alternativo → rule-based.
  // Exportado para testing.
  providerCascade(primary: AiModel): AiProvider[] {
    const cascade: AiProvider[] = [this.providerFor(primary)];
    const alt = ALTERNATIVE_MODEL[primary];
    if (alt) cascade.push(this.providerFor(alt));
    cascade.push(this.fallback);
    return cascade;
  }

  private providerFor(model: AiModel): AiProvider {
    switch (model) {
      case 'claude-haiku-5-5':
      case 'claude-sonnet-5-5':
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

// También exportamos para que tests + callers que quieran forzar un
// modelo específico puedan usarlo sin ir al env.
export { ALTERNATIVE_MODEL, MODEL_BY_OPERATION, defaultModel };

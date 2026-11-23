// Cuotas de IA por organización por mes. Un plan declara cuántos tokens
// puede gastar la org cada mes; si se pasa, el router degrada a rule-based.

import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { AiOperation, AiResponse } from './ai-provider';

// Default cuando el plan no declara AI_TOKEN_BUDGET explícito (sanity cap).
const DEFAULT_MONTHLY_TOKENS = 500_000;

function monthKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

@Injectable()
export class BudgetService {
  constructor(private readonly prisma: PrismaService) {}

  async getBudget(organizationId: string): Promise<{
    monthKey: string; aiTokensUsed: number; aiTokensLimit: number | null;
    aiCostCop: number; remainingTokens: number | null;
  }> {
    const key = monthKey();
    const [budget, limit] = await Promise.all([
      this.prisma.orgBudget.findUnique({
        where: { organizationId_monthKey: { organizationId, monthKey: key } },
      }),
      this.resolveLimit(organizationId),
    ]);
    const used = budget?.aiTokensUsed ?? 0;
    const costCop = budget?.aiCostCop ?? 0;
    return {
      monthKey: key,
      aiTokensUsed: used,
      aiTokensLimit: limit,
      aiCostCop: costCop,
      remainingTokens: limit === null ? null : Math.max(0, limit - used),
    };
  }

  async ensureBudget(organizationId: string, estimatedTokens: number): Promise<void> {
    const { aiTokensUsed, aiTokensLimit } = await this.getBudget(organizationId);
    if (aiTokensLimit !== null && aiTokensUsed + estimatedTokens > aiTokensLimit) {
      throw new ForbiddenException('Presupuesto IA del mes agotado. Actualiza de plan o espera al próximo mes.');
    }
  }

  async recordConsumption(
    organizationId: string, projectId: string | null, operation: AiOperation,
    response: AiResponse, runKey: string | null,
  ): Promise<void> {
    const key = monthKey();
    const totalTokens = response.inputTokens + response.outputTokens;
    await this.prisma.$transaction([
      this.prisma.meteredAi.create({
        data: {
          organizationId, projectId, operation, model: response.model,
          inputTokens: response.inputTokens, outputTokens: response.outputTokens,
          costCop: response.estimatedCostCop, runKey, month: new Date(key + '-01'),
        },
      }),
      this.prisma.orgBudget.upsert({
        where: { organizationId_monthKey: { organizationId, monthKey: key } },
        create: { organizationId, monthKey: key, aiTokensUsed: totalTokens, aiCostCop: response.estimatedCostCop },
        update: {
          aiTokensUsed: { increment: totalTokens },
          aiCostCop: { increment: response.estimatedCostCop },
        },
      }),
    ]);
  }

  private async resolveLimit(organizationId: string): Promise<number | null> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: { include: { capabilities: true } } },
    });
    const plan = subscription?.plan;
    const capability = plan?.capabilities.find(item => item.code === 'AI_DOCUMENT_ANALYSIS');
    if (plan?.code === 'enterprise' && capability?.availability === 'OPERATIONAL' && capability.monthlyLimit === null) {
      return null;
    }
    return capability?.monthlyLimit ?? DEFAULT_MONTHLY_TOKENS;
  }
}

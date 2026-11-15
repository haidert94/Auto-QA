import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { newToken } from './account';
import { planInclude, publicPlan } from './plan-capabilities';

type Event = { id: string; reference: string; amountCop: number; outcome: 'approved' | 'failed'; time: number };
export interface PaymentProvider {
  readonly name: string;
  createReference(): string;
  verify(payload: string, signature: string): Event;
}

export function subscriptionStatus(subscription: { status: SubscriptionStatus; periodEndsAt: Date | null } | null) {
  if (!subscription) return 'PENDING';
  if (['ACTIVE', 'TRIALING'].includes(subscription.status) &&
    (!subscription.periodEndsAt || subscription.periodEndsAt <= new Date())) return 'EXPIRED';
  return subscription.status;
}

@Injectable()
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'sandbox';

  private secret() {
    const value = process.env.AUTOQA_SANDBOX_PAYMENT_SECRET;
    if (process.env.AUTOQA_PAYMENTS_MODE !== 'sandbox' || process.env.AUTOQA_DEPLOYMENT === 'hosted' ||
      !value || !/^[a-f0-9]{64}$/.test(value)) throw new ServiceUnavailableException('Contratación de prueba sin configurar.');
    return value;
  }

  enabled() {
    try { this.secret(); return true; } catch { return false; }
  }

  createReference() { this.secret(); return newToken(); }

  sign(payload: string) { return createHmac('sha256', this.secret()).update(payload).digest('hex'); }

  verify(payload: string, signature: string): Event {
    if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(this.sign(payload), 'hex'))) {
      throw new UnauthorizedException('Firma de evento inválida.');
    }
    let event: Event;
    try { event = JSON.parse(payload); } catch { throw new BadRequestException('Evento inválido.'); }
    if (!event || typeof event.id !== 'string' || !/^[a-z0-9-]{8,120}$/.test(event.id) ||
      typeof event.reference !== 'string' || !/^[a-f0-9]{64}$/.test(event.reference) ||
      !Number.isSafeInteger(event.amountCop) || event.amountCop <= 0 || !['approved', 'failed'].includes(event.outcome) ||
      !Number.isSafeInteger(event.time) || Math.abs(Date.now() - event.time) > 300000) {
      throw new BadRequestException('Evento inválido o vencido.');
    }
    return event;
  }
}

@Injectable()
export class BillingService {
  constructor(private readonly db: PrismaService, private readonly sandbox: SandboxPaymentProvider) {}

  async plans() {
    const plans = await this.db.plan.findMany({
      where: { enabled: true }, orderBy: { position: 'asc' }, include: planInclude,
    });
    return plans.map(publicPlan);
  }

  async checkout(organizationId: string, planCode: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
      const current = await tx.subscription.findUniqueOrThrow({ where: { organizationId } });
      const plan = await tx.plan.findFirst({ where: { code: planCode, enabled: true } });
      if (!plan) throw new BadRequestException('Plan no disponible.');
      if (['ACTIVE', 'TRIALING'].includes(subscriptionStatus(current))) throw new ConflictException('Ya tienes una suscripción vigente.');
      if (current.status === 'PENDING' && current.planCode === planCode && current.reference &&
        current.quotedPriceCop === plan.priceCop) return { reference: current.reference };
      const reference = this.sandbox.createReference();
      const days = Number(process.env.AUTOQA_TRIAL_DAYS || 0);
      const trial = !current.trialUsed && Number.isInteger(days) && days >= 1 && days <= 30;
      await tx.subscription.update({ where: { organizationId }, data: {
        planCode, reference, quotedPriceCop: plan.priceCop, status: trial ? 'TRIALING' : 'PENDING',
        trialUsed: current.trialUsed || trial, periodEndsAt: trial ? new Date(Date.now() + days * 86400000) : null,
      } });
      return { reference };
    });
  }

  async cancel(organizationId: string) {
    await this.db.subscription.update({ where: { organizationId }, data: { status: 'CANCELED' } });
    return { status: 'CANCELED' };
  }

  async simulate(organizationId: string, outcome: Event['outcome']) {
    const checkout = await this.db.subscription.findUniqueOrThrow({ where: { organizationId } });
    if (!checkout.reference || !checkout.quotedPriceCop) throw new ConflictException('Inicia una contratación primero.');
    const payload = JSON.stringify({
      id: checkout.reference + '-' + outcome, reference: checkout.reference,
      outcome, amountCop: checkout.quotedPriceCop, time: Date.now(),
    });
    return this.accept(this.sandbox, payload, this.sandbox.sign(payload));
  }

  async accept(provider: PaymentProvider, payload: string, signature: string) {
    const event = provider.verify(payload, signature);
    return this.db.$transaction(async tx => {
      const item = await tx.subscription.findUnique({ where: { reference: event.reference } });
      if (!item) throw new BadRequestException('Referencia de contratación desconocida.');
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${item.organizationId} FOR UPDATE`;
      const eventId = provider.name + ':' + event.id;
      if (await tx.billingEvent.findUnique({ where: { id: eventId } })) return { processed: true };
      const current = await tx.subscription.findUniqueOrThrow({ where: { id: item.id } });
      if (current.reference !== event.reference || current.quotedPriceCop !== event.amountCop ||
        !['PENDING', 'TRIALING'].includes(current.status)) throw new ConflictException('El evento no corresponde a una contratación pendiente.');
      const approved = event.outcome === 'approved';
      const end = new Date();
      const originalDay = end.getUTCDate();
      end.setUTCDate(1);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
      end.setUTCDate(Math.min(originalDay, lastDay));
      await tx.billingEvent.create({ data: { id: eventId, subscriptionId: item.id } });
      await tx.payment.create({ data: { reference: event.reference, subscriptionId: item.id, provider: provider.name, amountCop: event.amountCop, approved } });
      await tx.subscription.update({ where: { id: item.id }, data: {
        status: approved ? 'ACTIVE' : 'PAYMENT_FAILED', periodEndsAt: approved ? end : null,
      } });
      return { processed: true };
    });
  }
}

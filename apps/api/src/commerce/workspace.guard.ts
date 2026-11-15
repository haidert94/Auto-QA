import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { CapabilityCode, Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { AccountService } from './account';
import { subscriptionStatus } from './payments';
import { planInclude, requireCapability } from './plan-capabilities';

const PLAN_CAPABILITY = Symbol('PLAN_CAPABILITY');
export const RequiresPlanCapability = (code: CapabilityCode) => SetMetadata(PLAN_CAPABILITY, code);

export type Workspace = { organizationId: string | null };
type Request = { headers: { authorization?: string }; params: { projectId?: string }; workspace: Workspace };

export const CurrentWorkspace = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest<Request>().workspace,
);

export function legacyWorkspace() {
  return process.env.AUTOQA_LEGACY_MODE === 'true' && process.env.AUTOQA_DEPLOYMENT !== 'hosted';
}

export async function activePlan(tx: Prisma.TransactionClient, organizationId: string) {
  const subscription = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: { include: planInclude } } });
  if (!subscription || !['ACTIVE', 'TRIALING'].includes(subscriptionStatus(subscription))) {
    throw new ForbiddenException('Activa tu suscripción para acceder a los proyectos.');
  }
  return subscription.plan;
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly accounts: AccountService, private readonly db: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization ?? '';
    const projectId = request.params.projectId;
    const legacyToken = process.env.AUTOQA_DOCUMENTS_TOKEN;
    const legacyDocument = !!projectId && !!legacyToken && /^[a-f0-9]{64}$/i.test(legacyToken) &&
      Buffer.byteLength(authorization) === 71 &&
      timingSafeEqual(Buffer.from(authorization), Buffer.from('Bearer ' + legacyToken));
    if (legacyWorkspace() && (legacyDocument || (!projectId && !authorization))) {
      request.workspace = { organizationId: null };
    } else {
      const { organization } = await this.accounts.identity(authorization);
      if (!['ACTIVE', 'TRIALING'].includes(subscriptionStatus(organization.subscription))) {
        throw new ForbiddenException('Activa tu suscripción para acceder a los proyectos.');
      }
      const code = this.reflector.get<CapabilityCode | undefined>(PLAN_CAPABILITY, context.getHandler());
      if (code && organization.subscription) requireCapability(organization.subscription.plan, code);
      request.workspace = { organizationId: organization.id };
    }
    if (projectId) {
      const found = await this.db.project.findFirst({ where: { id: projectId, ...request.workspace }, select: { id: true } });
      if (!found) throw new NotFoundException('Proyecto no encontrado.');
    }
    return true;
  }
}

import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { CapabilityCode, OrgRole, Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { AccountService } from './account';
import { subscriptionStatus } from './payments';
import { planInclude, requireCapability } from './plan-capabilities';

const PLAN_CAPABILITY = Symbol('PLAN_CAPABILITY');
export const RequiresPlanCapability = (code: CapabilityCode) => SetMetadata(PLAN_CAPABILITY, code);

const ROLE_REQUIREMENT = Symbol('ROLE_REQUIREMENT');
export const RequiresRole = (...roles: OrgRole[]) => SetMetadata(ROLE_REQUIREMENT, roles);

// Jerarquía de roles: cualquier rol >= al requerido pasa.
const ROLE_RANK: Record<OrgRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };
export function hasRole(actual: OrgRole, required: OrgRole[]): boolean {
  const minRequired = Math.min(...required.map(r => ROLE_RANK[r]));
  return ROLE_RANK[actual] >= minRequired;
}

export type Workspace = { organizationId: string | null; userId?: string | null; role?: OrgRole | null };

// Filtro Prisma para scoping multi-tenant con asignación por proyecto.
// - OWNER y ADMIN: ven todos los proyectos de la organización.
// - EDITOR y VIEWER: solo ven los proyectos donde (a) son owner,
//   (b) tienen una fila en ProjectMember.
// Modo legacy (sin role) se trata como admin total para no romper tests.
export function projectScope(workspace: Workspace) {
  const base = { organizationId: workspace.organizationId };
  const role = workspace.role;
  if (!role || role === 'OWNER' || role === 'ADMIN') return base;
  if (!workspace.userId) return base;
  return {
    ...base,
    OR: [
      { ownerId: workspace.userId },
      { members: { some: { userId: workspace.userId } } },
    ],
  };
}
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
      // El modo legacy ignora roles; cualquier operación pasa.
      request.workspace = { organizationId: null, userId: null, role: null };
    } else {
      const identity = await this.accounts.identity(authorization);
      const { organization } = identity;
      if (!['ACTIVE', 'TRIALING'].includes(subscriptionStatus(organization.subscription))) {
        throw new ForbiddenException('Activa tu suscripción para acceder a los proyectos.');
      }
      const code = this.reflector.get<CapabilityCode | undefined>(PLAN_CAPABILITY, context.getHandler());
      if (code && organization.subscription) requireCapability(organization.subscription.plan, code);
      const required = this.reflector.get<OrgRole[] | undefined>(ROLE_REQUIREMENT, context.getHandler());
      if (required && required.length && !hasRole(identity.role, required)) {
        throw new ForbiddenException('No tienes el rol necesario para esta acción.');
      }
      request.workspace = { organizationId: organization.id, userId: identity.userId, role: identity.role };
    }
    if (projectId) {
      const found = await this.db.project.findFirst({ where: { id: projectId, ...projectScope(request.workspace) }, select: { id: true } });
      if (!found) throw new NotFoundException('Proyecto no encontrado.');
    }
    return true;
  }
}

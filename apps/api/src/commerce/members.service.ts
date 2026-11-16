import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type OrgRole, Prisma } from '@prisma/client';
import { AccountMail } from './account-mail';
import { digest, newToken } from './account';
import { hasRole, type Workspace } from './workspace.guard';
import { PrismaService } from '../prisma.service';

const INVITE_TTL_SECONDS = 7 * 86400;

@Injectable()
export class MembersService {
  constructor(private readonly db: PrismaService, private readonly mail: AccountMail) {}

  // --- Listado ------------------------------------------------------------

  async list(workspace: Workspace) {
    const organizationId = this.requireOrg(workspace);
    const [members, invites] = await Promise.all([
      this.db.organizationMember.findMany({
        where: { organizationId },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        select: { userId: true, role: true, joinedAt: true,
          user: { select: { name: true, email: true } } },
      }),
      this.db.organizationInvite.findMany({
        where: { organizationId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, role: true, createdAt: true, expiresAt: true,
          invitedBy: { select: { name: true, email: true } } },
      }),
    ]);
    return { members, invites };
  }

  // --- Invitaciones -------------------------------------------------------

  async invite(workspace: Workspace, dto: { email: string; role: OrgRole }, actorIp: string | null) {
    const organizationId = this.requireOrg(workspace);
    this.requireRole(workspace, ['ADMIN']);
    const email = dto.email.trim().toLowerCase();
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(email)) throw new BadRequestException('Correo no válido.');
    if (dto.role === 'OWNER') throw new BadRequestException('No puedes invitar a otro OWNER.');

    // Rechaza si ya es miembro.
    const existingUser = await this.db.user.findUnique({ where: { email }, select: { membership: { select: { organizationId: true } } } });
    if (existingUser?.membership?.organizationId === organizationId) {
      throw new ConflictException('Ese correo ya pertenece a la organización.');
    }
    if (existingUser?.membership?.organizationId) {
      throw new ConflictException('Ese correo ya pertenece a otra organización.');
    }

    const token = newToken();
    const dg = digest(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000);
    try {
      await this.db.organizationInvite.upsert({
        where: { organizationId_email: { organizationId, email } },
        create: { organizationId, email, role: dto.role, digest: dg, expiresAt, invitedByUserId: workspace.userId! },
        update: { role: dto.role, digest: dg, expiresAt, invitedByUserId: workspace.userId! },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe una invitación para ese correo.');
      }
      throw error;
    }
    const org = await this.db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    this.mail.available();
    await this.mail.sendInvite(email, token, org?.name ?? 'AutoQA', dto.role);
    await this.audit(organizationId, workspace.userId ?? null, 'invite-created', 'invite', email, actorIp);
    return { message: 'Invitación enviada.' };
  }

  async revokeInvite(workspace: Workspace, inviteId: string, actorIp: string | null) {
    const organizationId = this.requireOrg(workspace);
    this.requireRole(workspace, ['ADMIN']);
    const invite = await this.db.organizationInvite.findFirst({
      where: { id: inviteId, organizationId }, select: { id: true, email: true },
    });
    if (!invite) throw new NotFoundException('Invitación no encontrada.');
    await this.db.organizationInvite.delete({ where: { id: invite.id } });
    await this.audit(organizationId, workspace.userId ?? null, 'invite-revoked', 'invite', invite.email, actorIp);
    return { message: 'Invitación revocada.' };
  }

  // --- Previsualización pública (sin sesión) ------------------------------

  async describeInvite(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new NotFoundException('Invitación no encontrada.');
    const invite = await this.db.organizationInvite.findUnique({
      where: { digest: digest(token) },
      select: {
        email: true, role: true, expiresAt: true,
        organization: { select: { name: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (!invite || invite.expiresAt <= new Date()) throw new NotFoundException('La invitación ya no está disponible.');
    return invite;
  }

  // --- Aceptación por un usuario autenticado ------------------------------

  async accept(workspace: Workspace, token: string, userEmail: string, actorIp: string | null) {
    if (!workspace.userId) throw new ForbiddenException('Inicia sesión.');
    if (!/^[a-f0-9]{64}$/.test(token)) throw new NotFoundException('Invitación no encontrada.');
    const existing = await this.db.organizationMember.findUnique({ where: { userId: workspace.userId }, select: { organizationId: true } });

    await this.db.$transaction(async tx => {
      const invite = await tx.organizationInvite.findUnique({
        where: { digest: digest(token) },
        select: { id: true, email: true, role: true, organizationId: true, expiresAt: true },
      });
      if (!invite || invite.expiresAt <= new Date()) throw new NotFoundException('La invitación ya no está disponible.');
      if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw new ForbiddenException('La invitación está dirigida a otro correo.');
      }
      if (existing && existing.organizationId !== invite.organizationId) {
        throw new ConflictException('Ya perteneces a otra organización. Pide al admin de esa organización que te remueva primero.');
      }
      if (existing && existing.organizationId === invite.organizationId) {
        // Ya es miembro: solo consumir la invitación.
        await tx.organizationInvite.delete({ where: { id: invite.id } });
        return;
      }
      await tx.organizationMember.create({
        data: { userId: workspace.userId!, organizationId: invite.organizationId, role: invite.role },
      });
      await tx.organizationInvite.delete({ where: { id: invite.id } });
      await this.audit(invite.organizationId, workspace.userId!, 'invite-accepted', 'member', workspace.userId!, actorIp, tx);
    });
    return { message: 'Te uniste a la organización.' };
  }

  // --- Gestión de miembros ------------------------------------------------

  async remove(workspace: Workspace, userId: string, actorIp: string | null) {
    const organizationId = this.requireOrg(workspace);
    this.requireRole(workspace, ['ADMIN']);
    if (userId === workspace.userId) throw new BadRequestException('No puedes removerte a ti mismo; transfiere la propiedad primero.');
    const target = await this.db.organizationMember.findUnique({ where: { userId }, select: { role: true, organizationId: true } });
    if (!target || target.organizationId !== organizationId) throw new NotFoundException('Miembro no encontrado.');
    if (target.role === 'OWNER' && !hasRole(workspace.role ?? 'VIEWER', ['OWNER'])) {
      throw new ForbiddenException('Solo un OWNER puede remover a otro OWNER.');
    }
    if (target.role === 'OWNER') {
      // Nunca dejar la org sin OWNER.
      const owners = await this.db.organizationMember.count({ where: { organizationId, role: 'OWNER' } });
      if (owners <= 1) throw new BadRequestException('La organización quedaría sin OWNER. Transfiere la propiedad primero.');
    }
    await this.db.organizationMember.delete({ where: { userId } });
    await this.audit(organizationId, workspace.userId ?? null, 'member-removed', 'member', userId, actorIp);
    return { message: 'Miembro removido.' };
  }

  async changeRole(workspace: Workspace, userId: string, role: OrgRole, actorIp: string | null) {
    const organizationId = this.requireOrg(workspace);
    this.requireRole(workspace, ['OWNER']);
    const target = await this.db.organizationMember.findUnique({ where: { userId }, select: { role: true, organizationId: true } });
    if (!target || target.organizationId !== organizationId) throw new NotFoundException('Miembro no encontrado.');
    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = await this.db.organizationMember.count({ where: { organizationId, role: 'OWNER' } });
      if (owners <= 1) throw new BadRequestException('La organización quedaría sin OWNER.');
    }
    await this.db.organizationMember.update({ where: { userId }, data: { role } });
    await this.audit(organizationId, workspace.userId ?? null, 'role-changed', 'member', userId + ' → ' + role, actorIp);
    return { message: 'Rol actualizado.' };
  }

  // --- Auditoría ----------------------------------------------------------

  async listAudit(workspace: Workspace) {
    const organizationId = this.requireOrg(workspace);
    this.requireRole(workspace, ['ADMIN']);
    return this.db.accessAudit.findMany({
      where: { organizationId },
      orderBy: { at: 'desc' },
      take: 100,
      select: {
        id: true, action: true, targetKind: true, targetId: true, ip: true, at: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async audit(
    organizationId: string, userId: string | null, action: string,
    targetKind: string | null, targetId: string | null, ip: string | null,
    tx: Prisma.TransactionClient | null = null,
  ) {
    const client = tx ?? this.db;
    try {
      await client.accessAudit.create({
        data: { organizationId, userId, action, targetKind, targetId, ip: ip?.slice(0, 64) ?? null },
      });
    } catch {
      // No queremos romper la operación por una falla de auditoría; se loguea
      // vía el consumo normal de Nest (console) si alguna vez falla.
    }
  }

  // --- helpers ------------------------------------------------------------

  private requireOrg(workspace: Workspace): string {
    if (!workspace.organizationId) throw new ForbiddenException('Operación no disponible en modo legacy.');
    return workspace.organizationId;
  }
  private requireRole(workspace: Workspace, roles: OrgRole[]) {
    if (!workspace.role || !hasRole(workspace.role, roles)) {
      throw new ForbiddenException('No tienes el rol necesario para esta acción.');
    }
  }
}

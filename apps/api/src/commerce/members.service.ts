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
    const [members, invites, assignments, orgProjects] = await Promise.all([
      this.db.organizationMember.findMany({
        where: { organizationId },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        select: { userId: true, role: true, joinedAt: true,
          user: { select: { name: true, email: true } } },
      }),
      // Cast transitorio: la columna "name" del invite fue añadida después
      // de la última regeneración del cliente Prisma en algunos entornos.
      (this.db.organizationInvite.findMany as unknown as (args: unknown) => Promise<Array<{
        id: string; email: string; name: string | null; role: OrgRole;
        createdAt: Date; expiresAt: Date;
        invitedBy: { name: string | null; email: string };
      }>>)({
        where: { organizationId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, name: true, role: true, createdAt: true, expiresAt: true,
          invitedBy: { select: { name: true, email: true } },
        },
      }),
      // Asignaciones por proyecto para todos los miembros, limitadas a los
      // proyectos de ESTA organización (filtro de seguridad: evita leaks si
      // un usuario tuviera asignaciones heredadas de otra org).
      // Cast transitorio: el cliente Prisma puede no haberse regenerado en
      // el entorno local; el esquema persistido ya tiene la tabla.
      (this.db as unknown as { projectMember: { findMany(args: unknown): Promise<Array<{ userId: string; projectId: string; project: { name: string } }>> } })
        .projectMember.findMany({
          where: { project: { organizationId } },
          select: { userId: true, projectId: true, project: { select: { name: true } } },
        }),
      this.db.project.findMany({
        where: { organizationId, status: { not: 'ARCHIVED' } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const projectsByUser = new Map<string, { id: string; name: string }[]>();
    for (const row of assignments) {
      const list = projectsByUser.get(row.userId) ?? [];
      list.push({ id: row.projectId, name: row.project.name });
      projectsByUser.set(row.userId, list);
    }
    return {
      members: members.map(m => ({ ...m, projects: projectsByUser.get(m.userId) ?? [] })),
      invites,
      orgProjects,
    };
  }

  // --- Asignación de proyectos --------------------------------------------

  async setProjectAssignments(workspace: Workspace, targetUserId: string, projectIds: string[], actorIp: string | null) {
    const organizationId = this.requireOrg(workspace);
    this.requireRole(workspace, ['ADMIN']);
    const target = await this.db.organizationMember.findUnique({
      where: { userId: targetUserId }, select: { organizationId: true, role: true, user: { select: { email: true } } },
    });
    if (!target || target.organizationId !== organizationId) throw new NotFoundException('Miembro no encontrado.');
    // OWNER y ADMIN ven todo por definición; no tiene sentido asignarles
    // proyectos específicos. Lo rechazamos para no confundir al usuario.
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      throw new BadRequestException('OWNER y ADMIN ya ven todos los proyectos de la organización.');
    }
    const unique = [...new Set(projectIds)];
    // Verificar que todos los proyectos sean de la misma org (otro gate
    // anti cross-tenant). Si alguno no lo es, 404 silencioso.
    if (unique.length > 0) {
      const found = await this.db.project.findMany({
        where: { id: { in: unique }, organizationId }, select: { id: true },
      });
      if (found.length !== unique.length) throw new NotFoundException('Uno o más proyectos no existen en la organización.');
    }
    // Cast transitorio por regeneración del cliente Prisma.
    const projectMember = (this.db as unknown as { projectMember: {
      deleteMany(args: unknown): Promise<unknown>;
      createMany(args: unknown): Promise<unknown>;
    } }).projectMember;
    await this.db.$transaction([
      projectMember.deleteMany({ where: { userId: targetUserId, project: { organizationId } } }) as unknown as Prisma.PrismaPromise<unknown>,
      ...(unique.length > 0 ? [projectMember.createMany({
        data: unique.map(projectId => ({ projectId, userId: targetUserId, createdByUserId: workspace.userId ?? null })),
      }) as unknown as Prisma.PrismaPromise<unknown>] : []),
    ]);
    await this.audit(organizationId, workspace.userId ?? null,
      'PROJECT_ASSIGNMENT_CHANGED', 'user', targetUserId, actorIp);
    return { userId: targetUserId, projectIds: unique };
  }

  // --- Invitaciones -------------------------------------------------------

  async invite(workspace: Workspace, dto: { email: string; name?: string; role: OrgRole; projectIds?: string[] }, actorIp: string | null) {
    const organizationId = this.requireOrg(workspace);
    this.requireRole(workspace, ['ADMIN']);
    const name = dto.name?.trim() || null;
    // Pre-asignación: solo para EDITOR y VIEWER. Para OWNER/ADMIN la ignoramos
    // porque ven todos los proyectos por definición.
    const needsAssignment = dto.role === 'EDITOR' || dto.role === 'VIEWER';
    const projectIds = needsAssignment ? [...new Set(dto.projectIds ?? [])] : [];
    if (projectIds.length > 0) {
      const found = await this.db.project.findMany({
        where: { id: { in: projectIds }, organizationId }, select: { id: true },
      });
      if (found.length !== projectIds.length) {
        throw new NotFoundException('Uno o más proyectos no existen en la organización.');
      }
    }
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
        create: {
          organizationId, email, name, role: dto.role, projectIds,
          digest: dg, expiresAt, invitedByUserId: workspace.userId!,
        } as Prisma.OrganizationInviteUncheckedCreateInput,
        update: {
          name, role: dto.role, projectIds,
          digest: dg, expiresAt, invitedByUserId: workspace.userId!,
        } as Prisma.OrganizationInviteUncheckedUpdateInput,
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
    const invite = await (this.db.organizationInvite.findUnique as unknown as (args: unknown) => Promise<{
      email: string; name: string | null; role: OrgRole; expiresAt: Date;
      organization: { name: string };
      invitedBy: { name: string | null; email: string };
    } | null>)({
      where: { digest: digest(token) },
      select: {
        email: true, name: true, role: true, expiresAt: true,
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
      // Cast transitorio: el cliente Prisma local puede no conocer todavía
      // la columna projectIds. El esquema persistido ya la tiene.
      const inviteRaw = await (tx.organizationInvite.findUnique as unknown as (args: unknown) => Promise<{
        id: string; email: string; role: OrgRole; organizationId: string;
        expiresAt: Date; projectIds: string[] | null;
      } | null>)({
        where: { digest: digest(token) },
        select: {
          id: true, email: true, role: true, organizationId: true, expiresAt: true,
          projectIds: true,
        },
      });
      const invite = inviteRaw;
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
      // Si la invitación traía proyectos pre-asignados (solo para EDITOR/
      // VIEWER), creamos las filas de ProjectMember en la misma transacción
      // para que al primer login el usuario vea exactamente esos proyectos.
      const needsAssignment = invite.role === 'EDITOR' || invite.role === 'VIEWER';
      const toAssign = needsAssignment && Array.isArray(invite.projectIds) ? invite.projectIds : [];
      if (toAssign.length > 0) {
        const projectMember = (tx as unknown as { projectMember: {
          createMany(args: unknown): Promise<unknown>;
        } }).projectMember;
        // Verificar que los proyectos siguen siendo de la misma org (defensivo
        // por si cambiaron entre invite y accept).
        const stillValid = await tx.project.findMany({
          where: { id: { in: toAssign }, organizationId: invite.organizationId },
          select: { id: true },
        });
        if (stillValid.length > 0) {
          await projectMember.createMany({
            data: stillValid.map(p => ({ projectId: p.id, userId: workspace.userId!, createdByUserId: null })),
          });
        }
      }
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

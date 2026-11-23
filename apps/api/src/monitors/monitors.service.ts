import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { validateExplorationUrlSync, type GuardScope } from '../exploration/url-guard';
import { CreateMonitorDto, UpdateMonitorDto } from './dto/create-monitor.dto';

function scopeFromEnvironment(env: { allowedHosts: Prisma.JsonValue; allowedPaths: Prisma.JsonValue; excludedPaths: Prisma.JsonValue }): GuardScope {
  const toStringArray = (value: Prisma.JsonValue): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    allowedHosts: toStringArray(env.allowedHosts),
    allowedPaths: toStringArray(env.allowedPaths),
    excludedPaths: toStringArray(env.excludedPaths),
  };
}

@Injectable()
export class MonitorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.monitor.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, url: true, active: true,
        intervalMinutes: true, timeoutMs: true, notifyEmails: true,
        lastCheckedAt: true, lastStatus: true, lastLatencyMs: true, lastHttpStatus: true,
        environmentId: true, createdAt: true,
      },
    });
  }

  async get(projectId: string, monitorId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, projectId },
      include: {
        environment: { select: { id: true, baseUrl: true, type: true } },
        checks: { where: { status: { in: ['UP', 'DOWN'] } }, orderBy: { at: 'desc' }, take: 100,
          select: { id: true, at: true, status: true, httpStatus: true, latencyMs: true, errorCode: true } },
      },
    });
    if (!monitor) throw new NotFoundException('Monitor no encontrado.');
    return monitor;
  }

  async create(projectId: string, dto: CreateMonitorDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const environment = await this.prisma.environment.findFirst({ where: { id: dto.environmentId, projectId } });
    if (!environment) throw new NotFoundException('Entorno no encontrado.');
    if (!environment.authorizationConfirmed) {
      throw new BadRequestException('Confirma la autorización del entorno antes de monitorearlo.');
    }

    const scope = scopeFromEnvironment(environment);
    const guard = validateExplorationUrlSync(dto.url, scope);
    if (!guard.ok) {
      throw new BadRequestException({ issue: guard.issue, detail: guard.detail,
        message: 'La URL no pasó las validaciones de alcance.' });
    }

    return this.prisma.monitor.create({
      data: {
        projectId,
        environmentId: environment.id,
        name: dto.name.trim(),
        url: guard.url.toString(),
        intervalMinutes: dto.intervalMinutes ?? 15,
        timeoutMs: dto.timeoutMs ?? 10000,
        notifyEmails: dto.notifyEmails ?? [],
        createdByUserId: workspace.userId ?? null,
      },
      select: {
        id: true, name: true, url: true, active: true,
        intervalMinutes: true, timeoutMs: true, notifyEmails: true, createdAt: true,
      },
    });
  }

  async update(projectId: string, monitorId: string, dto: UpdateMonitorDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const existing = await this.prisma.monitor.findFirst({ where: { id: monitorId, projectId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Monitor no encontrado.');
    return this.prisma.monitor.update({
      where: { id: monitorId },
      data: {
        name: dto.name?.trim(),
        active: dto.active,
        intervalMinutes: dto.intervalMinutes,
        timeoutMs: dto.timeoutMs,
        notifyEmails: dto.notifyEmails,
      },
      select: { id: true, name: true, active: true, intervalMinutes: true, timeoutMs: true, notifyEmails: true },
    });
  }

  async remove(projectId: string, monitorId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const existing = await this.prisma.monitor.findFirst({ where: { id: monitorId, projectId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Monitor no encontrado.');
    await this.prisma.monitor.delete({ where: { id: monitorId } });
    return { message: 'Monitor eliminado.' };
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

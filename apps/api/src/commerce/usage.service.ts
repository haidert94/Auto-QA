import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { activePlan } from './workspace.guard';
import { availability, capabilityFor, planInclude, requireCapability, runAvailability } from './plan-capabilities';
import { assertMonitorQuota, assertRunQuota, positiveInteger, type RunRequest } from './usage-quotas';

const capabilities = { BROWSER: 'BROWSER_TESTS', API: 'API_TESTS', PERFORMANCE: 'PERFORMANCE_TESTS' } as const;

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function validateKey(key: string) {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(key)) throw new BadRequestException('Identificador de consumo inválido.');
}

@Injectable()
export class UsageService {
  constructor(private readonly db: PrismaService) {}

  private async lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  }

  private async requireProject(tx: Prisma.TransactionClient, organizationId: string, projectId: string) {
    const project = await tx.project.findFirst({
      where: { id: projectId, organizationId, status: 'READY' }, select: { id: true },
    });
    if (!project) throw new NotFoundException('Proyecto no disponible para ejecución.');
  }

  private async counters(tx: Prisma.TransactionClient, organizationId: string, month: Date) {
    const period = { organizationId, month };
    const finished = await tx.meteredRun.aggregate({
      where: { ...period, completedAt: { not: null } },
      _sum: { browserSeconds: true }, _count: true,
    });
    const reserved = await tx.meteredRun.aggregate({
      where: { organizationId, completedAt: null }, _sum: { reservedBrowserSeconds: true }, _count: true,
    });
    const performanceRuns = await tx.meteredRun.count({ where: { ...period, kind: 'PERFORMANCE' } });
    const pendingPerformance = await tx.meteredRun.count({
      where: { organizationId, month: { lt: month }, completedAt: null, kind: 'PERFORMANCE' },
    });
    const monitors = await tx.meteredMonitor.count({ where: { organizationId, disabledAt: null } });
    return {
      running: reserved._count, browserSeconds: finished._sum.browserSeconds ?? 0,
      reservedBrowserSeconds: reserved._sum.reservedBrowserSeconds ?? 0,
      finished: finished._count, performanceRuns, pendingPerformance, monitors,
    };
  }

  async summary(organizationId: string) {
    return this.db.$transaction(async tx => {
      const subscription = await tx.subscription.findUnique({
        where: { organizationId }, include: { plan: { include: planInclude } },
      });
      if (!subscription) throw new NotFoundException('Suscripción no encontrada.');
      const plan = subscription.plan;
      const month = monthStart();
      const counters = await this.counters(tx, organizationId, month);
      const projects = await tx.project.findMany({
        where: { organizationId, status: { not: 'ARCHIVED' } },
        select: { id: true, name: true, _count: { select: { roles: true } } },
        orderBy: { name: 'asc' },
      });
      const browser = capabilityFor(plan, 'BROWSER_TESTS');
      const monitor = capabilityFor(plan, 'HTTP_MONITORS');
      const performance = capabilityFor(plan, 'PERFORMANCE_TESTS');
      return {
        month: month.toISOString().slice(0, 7),
        projects: { used: projects.length, limit: plan.maxProjects },
        roles: { limit: plan.maxRoles, projects: projects.map(({ id, name, _count }) => ({ id, name, used: _count.roles })) },
        browser: { secondsUsed: counters.browserSeconds, secondsReserved: counters.reservedBrowserSeconds,
          minutesLimit: browser?.monthlyLimit ?? 0, availability: browser ? availability(browser) : 'NOT_INCLUDED' },
        runs: { active: counters.running, simultaneousLimit: plan.parallelRuns, completed: counters.finished,
          availability: runAvailability(plan) },
        monitors: { active: counters.monitors, limit: monitor?.monitorLimit ?? 0,
          availability: monitor ? availability(monitor) : 'NOT_INCLUDED' },
        performance: { used: counters.performanceRuns, previousPending: counters.pendingPerformance, limit: performance?.monthlyLimit ?? 0,
          availability: performance ? availability(performance) : 'NOT_INCLUDED' },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  // Internal worker boundary. The catalog cannot enable an engine on its own.
  async reserveRun(organizationId: string, projectId: string, runKey: string, request: RunRequest) {
    validateKey(runKey);
    return this.db.$transaction(async tx => {
      await this.lockOrganization(tx, organizationId);
      const plan = await activePlan(tx, organizationId);
      requireCapability(plan, capabilities[request.kind]);
      // The future performance worker must verify persisted authorization and safety limits here.
      if (request.kind === 'PERFORMANCE') {
        throw new ForbiddenException('Performance requiere autorización y controles de ejecución verificados.');
      }
      await this.requireProject(tx, organizationId, projectId);
      const requestedBrowser = request.kind === 'BROWSER' ? request.browser : null;
      const reservedBrowserSeconds = request.kind === 'BROWSER' ? request.browserSeconds : 0;
      const previous = await tx.meteredRun.findUnique({ where: { organizationId_runKey: { organizationId, runKey } } });
      if (previous) {
        if (previous.projectId !== projectId || previous.kind !== request.kind ||
            previous.requestedBrowser !== requestedBrowser || previous.reservedBrowserSeconds !== reservedBrowserSeconds) {
          throw new ConflictException('La clave de ejecución ya corresponde a otra reserva.');
        }
        return previous;
      }
      const month = monthStart();
      const counters = await this.counters(tx, organizationId, month);
      assertRunQuota(plan, request, {
        running: counters.running,
        browserSeconds: counters.browserSeconds + counters.reservedBrowserSeconds,
        performanceRuns: counters.performanceRuns + counters.pendingPerformance,
      });
      return tx.meteredRun.create({ data: {
        organizationId, projectId, runKey, kind: request.kind, month, requestedBrowser, reservedBrowserSeconds,
      } });
    });
  }

  async settleRun(organizationId: string, runKey: string, browserSeconds: number) {
    if (!(browserSeconds === 0 || positiveInteger(browserSeconds))) throw new BadRequestException('Consumo inválido.');
    return this.db.$transaction(async tx => {
      await this.lockOrganization(tx, organizationId);
      const where = { organizationId_runKey: { organizationId, runKey } };
      const run = await tx.meteredRun.findUnique({ where });
      if (!run) throw new NotFoundException('Reserva no encontrada.');
      if ((run.kind !== 'BROWSER' && browserSeconds !== 0) ||
          (run.completedAt && run.browserSeconds !== browserSeconds)) {
        throw new ConflictException('El consumo no corresponde a la reserva.');
      }
      return run.completedAt ? run : tx.meteredRun.update({
        where, data: { browserSeconds, completedAt: new Date() },
      });
    });
  }

  async reserveMonitor(organizationId: string, projectId: string, monitorKey: string, intervalMinutes: number) {
    validateKey(monitorKey);
    return this.db.$transaction(async tx => {
      await this.lockOrganization(tx, organizationId);
      const plan = await activePlan(tx, organizationId);
      requireCapability(plan, 'HTTP_MONITORS');
      await this.requireProject(tx, organizationId, projectId);
      const where = { organizationId_monitorKey: { organizationId, monitorKey } };
      const previous = await tx.meteredMonitor.findUnique({ where });
      if (previous) {
        if (previous.projectId !== projectId || previous.intervalMinutes !== intervalMinutes || previous.disabledAt) {
          throw new ConflictException('La clave de monitor ya corresponde a otro registro.');
        }
        return previous;
      }
      const active = await tx.meteredMonitor.count({ where: { organizationId, disabledAt: null } });
      assertMonitorQuota(plan, active, intervalMinutes);
      return tx.meteredMonitor.create({ data: { organizationId, projectId, monitorKey, intervalMinutes } });
    });
  }

  async disableMonitor(organizationId: string, monitorKey: string) {
    await this.db.$transaction(async tx => {
      await this.lockOrganization(tx, organizationId);
      await tx.meteredMonitor.updateMany({
        where: { organizationId, monitorKey, disabledAt: null }, data: { disabledAt: new Date() },
      });
    });
  }
}

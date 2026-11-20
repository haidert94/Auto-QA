import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { availability, capabilityFor, type CatalogPlan } from './plan-capabilities';
import { browserMinutesLimit } from './browser-minutes';

export type RunRequest =
  | { kind: 'BROWSER'; browser: string; browserSeconds: number }
  | { kind: 'API' }
  | { kind: 'PERFORMANCE'; virtualUsers: number; durationMinutes: number };

export function positiveInteger(value: number) {
  return Number.isInteger(value) && value > 0 && value <= 2147483647;
}

export function assertRunQuota(plan: CatalogPlan, request: RunRequest,
  counters: { running: number; browserSeconds: number; performanceRuns: number }) {
  if (counters.running >= plan.parallelRuns) {
    throw new ConflictException({
      statusCode: 409, error: 'Conflict', code: 'RUN_CONCURRENCY_LIMIT',
      message: 'Alcanzaste el límite de ejecuciones simultáneas.',
    });
  }

  if (request.kind === 'BROWSER') {
    const capability = capabilityFor(plan, 'BROWSER_TESTS');
    if (!capability) throw new ForbiddenException('Navegador fuera del plan.');
    if (!capability.browsers.includes(request.browser)) {
      const crossBrowser = capabilityFor(plan, 'CROSS_BROWSER');
      const state = crossBrowser && availability(crossBrowser);
      if ((state !== 'OPERATIONAL' && state !== 'BETA') || !crossBrowser?.browsers.includes(request.browser)) {
        throw new ForbiddenException('Navegador fuera del plan.');
      }
    }
    if (!positiveInteger(request.browserSeconds)) throw new BadRequestException('Duración de navegador inválida.');
    const monthlyMinutes = browserMinutesLimit(plan.code, capability);
    if (monthlyMinutes !== null && counters.browserSeconds + request.browserSeconds > monthlyMinutes * 60) {
      throw new ConflictException('Superaste los minutos de navegador del mes.');
    }
  }

  if (request.kind === 'PERFORMANCE') {
    const capability = capabilityFor(plan, 'PERFORMANCE_TESTS');
    if (!capability?.monthlyLimit || capability.availability === 'NOT_INCLUDED') {
      throw new ForbiddenException('El plan requiere una cuota mensual de performance mayor que cero.');
    }
    if (!positiveInteger(request.virtualUsers) || !positiveInteger(request.durationMinutes)) {
      throw new BadRequestException('El tamaño y la duración de la prueba deben ser enteros positivos.');
    }
    if (request.virtualUsers > (capability.maxVirtualUsers ?? 0) || request.durationMinutes > (capability.maxDurationMinutes ?? 0)) {
      throw new ConflictException('Superaste el tamaño o la duración por ejecución de performance.');
    }
    if (counters.performanceRuns >= capability.monthlyLimit) {
      throw new ConflictException('Alcanzaste la cuota mensual de performance.');
    }
  }
}

export function assertMonitorQuota(plan: CatalogPlan, active: number, intervalMinutes: number) {
  const capability = capabilityFor(plan, 'HTTP_MONITORS');
  if (!positiveInteger(intervalMinutes)) throw new BadRequestException('Intervalo de monitor inválido.');
  if (!capability?.minIntervalMinutes || intervalMinutes < capability.minIntervalMinutes) {
    throw new ConflictException('El intervalo es inferior al mínimo de tu plan.');
  }
  if (active >= (capability.monitorLimit ?? 0)) {
    throw new ConflictException('Alcanzaste el límite de monitores activos.');
  }
}

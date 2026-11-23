// Ticker de monitores: toma hasta N monitores "vencidos" por tick,
// les hace HTTP GET (sin Chromium — es barato), guarda el check y
// dispara alertas si cambió el estado. No usa el filtro Playwright,
// pero sí revalida la URL con url-guard antes de cada chequeo (DNS
// podría haber cambiado desde que se creó el monitor).

import { request as httpRequest } from 'node:http';
import { request as httpsRequest, Agent } from 'node:https';
import type { PrismaClient } from '@prisma/client';
import { configuredUrlScope, validateExplorationUrl } from '../../api/src/exploration/url-guard';
import { RUN_CANCELED_BY_USER, RUN_STOP_REQUESTED } from '../../api/src/runs/run-cancellation';
import { withQualityStop } from './quality-attempt';

const BATCH_SIZE = 5;

export type MonitorClaim = {
  id: string;
  projectId: string;
  environmentId: string | null;
  url: string;
  timeoutMs: number;
  notifyEmails: string[];
  previousStatus: string | null;
  checkId?: string;
};

type Logger = (level: 'INFO' | 'WARN' | 'ERROR', detail: string) => void;

// Reserva hasta BATCH_SIZE monitores vencidos a la vez. Marca
// lastCheckedAt = now ANTES del chequeo real para que otros workers
// vean el valor actualizado y no tomen el mismo monitor.
async function claimRequestedChecks(prisma: PrismaClient): Promise<MonitorClaim[]> {
  return prisma.$queryRaw<MonitorClaim[]>`
    UPDATE "MonitorCheck" c SET status = 'RUNNING'
    FROM (
      SELECT c.id AS "checkId", m.id, m."projectId", m."environmentId", m.url,
        m."timeoutMs", m."notifyEmails", m."lastStatus" AS "previousStatus"
      FROM "MonitorCheck" c JOIN "Monitor" m ON m.id = c."monitorId"
      WHERE c.status = 'QUEUED'
      ORDER BY c.at, c.id
      FOR UPDATE OF c SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    ) picked
    WHERE c.id = picked."checkId"
    RETURNING picked.*
  `;
}

export async function claimDueMonitors(prisma: PrismaClient, limit = BATCH_SIZE): Promise<MonitorClaim[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; projectId: string; environmentId: string | null; url: string;
    timeoutMs: number; notifyEmails: string[]; lastStatus: string | null;
  }>>`
    UPDATE "Monitor"
    SET "lastCheckedAt" = now()
    WHERE id IN (
      SELECT id FROM "Monitor"
      WHERE active = true AND (
        "lastCheckedAt" IS NULL OR
        "lastCheckedAt" < now() - make_interval(mins => "intervalMinutes")
      )
      AND NOT EXISTS (
        SELECT 1 FROM "MonitorCheck" c WHERE c."monitorId" = "Monitor".id AND c.status IN ('QUEUED', 'RUNNING')
      )
      ORDER BY "lastCheckedAt" NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, "projectId", "environmentId", url, "timeoutMs", "notifyEmails", "lastStatus";
  `;
  return rows.map(row => ({
    id: row.id, projectId: row.projectId, environmentId: row.environmentId,
    url: row.url, timeoutMs: row.timeoutMs, notifyEmails: row.notifyEmails,
    previousStatus: row.lastStatus,
  }));
}

export type CheckOutcome = {
  status: 'UP' | 'DOWN';
  httpStatus: number | null;
  latencyMs: number | null;
  errorCode: string | null;
};

// HTTP HEAD → si no responde cae a GET. 2xx/3xx = UP; 4xx/5xx = DOWN.
// Timeout definido por el monitor. Un error de red devuelve DOWN con
// errorCode legible.
export async function performCheck(url: string, timeoutMs: number, signal?: AbortSignal): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const result = await httpOnce(url, timeoutMs, signal);
    const latencyMs = Date.now() - started;
    const up = result.status >= 200 && result.status < 400;
    return { status: up ? 'UP' : 'DOWN', httpStatus: result.status, latencyMs, errorCode: up ? null : 'http-' + result.status };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
    return { status: 'DOWN', httpStatus: null, latencyMs, errorCode: code };
  }
}

function httpOnce(url: string, timeoutMs: number, signal?: AbortSignal): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { reject(new Error('invalid-url')); return; }
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? httpsRequest : httpRequest;
    const agent = isHttps ? new Agent({ keepAlive: false }) : undefined;
    const req = transport({
      method: 'GET',
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      timeout: timeoutMs,
      signal,
      headers: { 'User-Agent': 'AutoQA-Monitor/0.1' },
      agent,
    }, response => {
      resolve({ status: response.statusCode ?? 0 });
      response.resume();
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', err => reject(err));
    req.end();
  });
}

export async function tickMonitors(prisma: PrismaClient, log: Logger, notify: (
  email: string, monitor: { name: string; url: string }, status: 'UP' | 'DOWN', detail: string,
) => Promise<void>): Promise<number> {
  const requested = await claimRequestedChecks(prisma);
  const monitors = [...requested, ...await claimDueMonitors(prisma, BATCH_SIZE - requested.length)];
  if (monitors.length === 0) return 0;

  await Promise.all(monitors.map(async claim => {
    // Revalidar URL con url-guard antes de chequear (DNS rebind).
    const environment = claim.environmentId
      ? await prisma.environment.findUnique({
        where: { id: claim.environmentId },
        select: { authorizationConfirmed: true, projectId: true, allowedHosts: true, allowedPaths: true, excludedPaths: true },
      })
      : null;
    if (claim.checkId && (!environment || environment.projectId !== claim.projectId || !environment.authorizationConfirmed)) {
      await recordCheck(prisma, claim, {
        status: 'DOWN', httpStatus: null, latencyMs: null, errorCode: 'quality-scope-invalid',
      }, log, notify);
      return;
    }
    if (environment) {
      const guard = await validateExplorationUrl(claim.url, configuredUrlScope(claim.url, environment));
      if (!guard.ok) {
        await recordCheck(prisma, claim, {
          status: 'DOWN', httpStatus: null, latencyMs: null,
          errorCode: 'guard-' + guard.issue,
        }, log, notify);
        return;
      }
    }
    const outcome = claim.checkId
      ? await withQualityStop(async () => {
        const check = await prisma.monitorCheck.findUnique({ where: { id: claim.checkId }, select: { errorCode: true, status: true } });
        return !check || check.status !== 'RUNNING' || check.errorCode === RUN_STOP_REQUESTED;
      }, signal => performCheck(claim.url, claim.timeoutMs, signal))
      : await performCheck(claim.url, claim.timeoutMs);
    await recordCheck(prisma, claim, outcome, log, notify);
  }));

  return monitors.length;
}

async function recordCheck(
  prisma: PrismaClient, claim: MonitorClaim, outcome: CheckOutcome,
  log: Logger,
  notify: (email: string, monitor: { name: string; url: string }, status: 'UP' | 'DOWN', detail: string) => Promise<void>,
): Promise<void> {
  const monitor = await prisma.$transaction(async tx => {
    const at = new Date();
    if (claim.checkId) {
      const completed = await tx.monitorCheck.updateMany({
        where: {
          id: claim.checkId, status: 'RUNNING',
          OR: [{ errorCode: null }, { errorCode: { not: RUN_STOP_REQUESTED } }],
        },
        data: { ...outcome, at },
      });
      if (!completed.count) {
        await tx.monitorCheck.updateMany({
          where: { id: claim.checkId, status: 'RUNNING', errorCode: RUN_STOP_REQUESTED },
          data: { status: 'CANCELED', errorCode: RUN_CANCELED_BY_USER, at },
        });
        return null;
      }
    } else {
      await tx.monitorCheck.create({ data: { monitorId: claim.id, ...outcome } });
    }
    return tx.monitor.update({
      where: { id: claim.id },
      data: {
        ...(claim.checkId ? { lastCheckedAt: at } : {}),
        lastStatus: outcome.status, lastLatencyMs: outcome.latencyMs, lastHttpStatus: outcome.httpStatus,
      },
      select: { id: true, name: true, url: true },
    });
  });
  if (!monitor) return;

  if (claim.previousStatus && claim.previousStatus !== outcome.status) {
    log('WARN', `${monitor.name} cambió ${claim.previousStatus} → ${outcome.status}`);
    const detail = outcome.errorCode ?? (outcome.httpStatus ? 'HTTP ' + outcome.httpStatus : '');
    for (const email of claim.notifyEmails) {
      try { await notify(email, monitor, outcome.status, detail); }
      catch (error) { log('WARN', 'No se pudo enviar alerta a ' + email + ': ' + (error instanceof Error ? error.message : String(error))); }
    }
  }
}

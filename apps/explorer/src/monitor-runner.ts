// Ticker de monitores: toma hasta N monitores "vencidos" por tick,
// les hace HTTP GET (sin Chromium — es barato), guarda el check y
// dispara alertas si cambió el estado. No usa el filtro Playwright,
// pero sí revalida la URL con url-guard antes de cada chequeo (DNS
// podría haber cambiado desde que se creó el monitor).

import { request as httpRequest } from 'node:http';
import { request as httpsRequest, Agent } from 'node:https';
import type { PrismaClient } from '@prisma/client';
import { validateExplorationUrl } from '../../api/src/exploration/url-guard';

const BATCH_SIZE = 5;

export type MonitorClaim = {
  id: string;
  projectId: string;
  environmentId: string | null;
  url: string;
  timeoutMs: number;
  notifyEmails: string[];
  previousStatus: string | null;
};

type Logger = (level: 'INFO' | 'WARN' | 'ERROR', detail: string) => void;

// Reserva hasta BATCH_SIZE monitores vencidos a la vez. Marca
// lastCheckedAt = now ANTES del chequeo real para que otros workers
// vean el valor actualizado y no tomen el mismo monitor.
export async function claimDueMonitors(prisma: PrismaClient): Promise<MonitorClaim[]> {
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
      ORDER BY "lastCheckedAt" NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
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
export async function performCheck(url: string, timeoutMs: number): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const result = await httpOnce(url, timeoutMs);
    const latencyMs = Date.now() - started;
    const up = result.status >= 200 && result.status < 400;
    return { status: up ? 'UP' : 'DOWN', httpStatus: result.status, latencyMs, errorCode: up ? null : 'http-' + result.status };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
    return { status: 'DOWN', httpStatus: null, latencyMs, errorCode: code };
  }
}

function httpOnce(url: string, timeoutMs: number): Promise<{ status: number }> {
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
  const monitors = await claimDueMonitors(prisma);
  if (monitors.length === 0) return 0;

  await Promise.all(monitors.map(async claim => {
    // Revalidar URL con url-guard antes de chequear (DNS rebind).
    const environment = claim.environmentId
      ? await prisma.environment.findUnique({
        where: { id: claim.environmentId },
        select: { allowedHosts: true, allowedPaths: true, excludedPaths: true },
      })
      : null;
    if (environment) {
      const guard = await validateExplorationUrl(claim.url, {
        allowedHosts: toStr(environment.allowedHosts),
        allowedPaths: toStr(environment.allowedPaths),
        excludedPaths: toStr(environment.excludedPaths),
      });
      if (!guard.ok) {
        await recordCheck(prisma, claim, {
          status: 'DOWN', httpStatus: null, latencyMs: null,
          errorCode: 'guard-' + guard.issue,
        }, log, notify);
        return;
      }
    }
    const outcome = await performCheck(claim.url, claim.timeoutMs);
    await recordCheck(prisma, claim, outcome, log, notify);
  }));

  return monitors.length;
}

async function recordCheck(
  prisma: PrismaClient, claim: MonitorClaim, outcome: CheckOutcome,
  log: Logger,
  notify: (email: string, monitor: { name: string; url: string }, status: 'UP' | 'DOWN', detail: string) => Promise<void>,
): Promise<void> {
  const [monitor] = await Promise.all([
    prisma.monitor.update({
      where: { id: claim.id },
      data: {
        lastStatus: outcome.status,
        lastLatencyMs: outcome.latencyMs,
        lastHttpStatus: outcome.httpStatus,
      },
      select: { id: true, name: true, url: true },
    }),
    prisma.monitorCheck.create({
      data: {
        monitorId: claim.id,
        status: outcome.status,
        httpStatus: outcome.httpStatus,
        latencyMs: outcome.latencyMs,
        errorCode: outcome.errorCode,
      },
    }),
  ]);

  if (claim.previousStatus && claim.previousStatus !== outcome.status) {
    log('WARN', `${monitor.name} cambió ${claim.previousStatus} → ${outcome.status}`);
    const detail = outcome.errorCode ?? (outcome.httpStatus ? 'HTTP ' + outcome.httpStatus : '');
    for (const email of claim.notifyEmails) {
      try { await notify(email, monitor, outcome.status, detail); }
      catch (error) { log('WARN', 'No se pudo enviar alerta a ' + email + ': ' + (error instanceof Error ? error.message : String(error))); }
    }
  }
}

function toStr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

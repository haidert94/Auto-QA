import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { configuredUrlScope, validateExplorationUrlSync } from '../exploration/url-guard';
import { defaultMonitorHttpCheck, monitorHttpCheckFields, type MonitorHttpCheck } from '../monitors/monitor-http-check';
import { prepareAvailability } from './quality-agents/availability-agent';
import { prepareLighthouse } from './quality-agents/lighthouse-agent';
import { prepareK6 } from './quality-agents/k6-agent';
import { prepareUx, renderUxFile } from './quality-agents/ux-agent';
import { QualityReviewRequired, type UxAgentContext } from './quality-agents/agent-context';

export const qualityTools = {
  availability: { tool: 'Node.js', filename: 'disponibilidad.mjs' },
  lighthouse: { tool: 'Lighthouse', filename: 'lighthouse.mjs' },
  load: { tool: 'k6', filename: 'carga.k6.js' },
  ux: { tool: 'Playwright', filename: 'evidencias-ux.mjs' },
} as const;

export type QualityKind = keyof typeof qualityTools;
export type QualityAutomation = (typeof qualityTools)[QualityKind] & { prepared: boolean; reviewReason?: string };

export const qualityAutomationSource = {
  projectId: true,
  environmentId: true,
  url: true,
  automationSignature: true,
  automationReview: true,
  environment: {
    select: {
      id: true, projectId: true, authorizationConfirmed: true, authorizedAt: true, readOnly: true,
      allowedHosts: true, allowedPaths: true, excludedPaths: true,
    },
  },
} as const;

type Source = Prisma.MonitorGetPayload<{ select: typeof qualityAutomationSource }> & {
  active?: boolean;
  timeoutMs?: number;
  intervalMinutes?: number;
  stages?: Prisma.JsonValue;
} & Partial<MonitorHttpCheck>;
type StoredSource = Source & { automationCode: string | null };
type QualityFile = QualityAutomation & { code?: string };

function environmentFor(source: Source) {
  return source.environment?.projectId === source.projectId ? source.environment : null;
}

export function qualityConfigurationSignature(kind: QualityKind, source: Source) {
  const environment = environmentFor(source);
  const check = kind === 'availability' ? customMonitorHttpCheck(source) : [];
  return createHash('sha256').update(JSON.stringify([
    2, kind, source.url, source.timeoutMs, source.intervalMinutes, source.stages, source.environmentId,
    environment?.authorizationConfirmed, environment?.authorizedAt,
    environment?.allowedHosts, environment?.allowedPaths, environment?.excludedPaths, ...check,
  ])).digest('hex');
}

function customMonitorHttpCheck(source: Partial<MonitorHttpCheck>) {
  const { method, minStatus, maxStatus } = { ...defaultMonitorHttpCheck, ...source };
  if (method === 'GET' && minStatus === 200 && maxStatus === 399) return [];
  return [method, minStatus, maxStatus];
}

export function authorizedTarget(source: Source): URL {
  const environment = environmentFor(source);
  if (!environment?.authorizationConfirmed) {
    throw new QualityReviewRequired('Asocia la prueba a un entorno autorizado.');
  }
  const checked = validateExplorationUrlSync(source.url, configuredUrlScope(source.url, environment));
  if (!checked.ok) throw new QualityReviewRequired('La URL de la prueba está fuera del alcance autorizado o es inválida.');
  return checked.url;
}

function wasPreparedByLegacyGenerator(kind: QualityKind, source: Source) {
  if (!source.automationSignature || source.automationReview || (kind === 'availability' && customMonitorHttpCheck(source).length)) return false;
  const legacy = createHash('sha256').update(JSON.stringify([1, kind, source.url, source.timeoutMs, source.stages])).digest('hex');
  if (source.automationSignature !== legacy) return false;
  try {
    authorizedTarget(source);
    return true;
  } catch (error) {
    if (error instanceof QualityReviewRequired) return false;
    throw error;
  }
}

export function qualityAutomationStatus(kind: QualityKind, source: Source): QualityAutomation {
  if (source.automationSignature === qualityConfigurationSignature(kind, source)) {
    return source.automationReview
      ? { ...qualityTools[kind], prepared: false, reviewReason: source.automationReview }
      : { ...qualityTools[kind], prepared: true };
  }
  return { ...qualityTools[kind], prepared: wasPreparedByLegacyGenerator(kind, source) };
}

function renderAgentFile(kind: QualityKind, source: Source, target: URL, uxContext?: UxAgentContext) {
  switch (kind) {
    case 'availability': return prepareAvailability(target, {
      timeoutMs: source.timeoutMs ?? 0, intervalMinutes: source.intervalMinutes ?? 0,
      method: source.method ?? defaultMonitorHttpCheck.method,
      minStatus: source.minStatus ?? defaultMonitorHttpCheck.minStatus,
      maxStatus: source.maxStatus ?? defaultMonitorHttpCheck.maxStatus,
    });
    case 'lighthouse': return prepareLighthouse(target);
    case 'load': return prepareK6(target, source.stages);
    case 'ux': return uxContext ? prepareUx(target, uxContext) : renderUxFile(target);
  }
}

function checkModuleSyntax(code: string): Promise<boolean> {
  // --check solo analiza el código. Nunca inicia el script ni importa sus dependencias.
  return new Promise((resolve, reject) => {
    const checker = spawn(process.execPath, ['--input-type=module', '--check'], {
      stdio: ['pipe', 'ignore', 'ignore'], timeout: 5000, windowsHide: true,
    });
    checker.once('error', reject);
    checker.once('close', status => resolve(status === 0));
    checker.stdin.on('error', reject);
    checker.stdin.end(code);
  });
}

export function readQualityExecutionSource(db: Prisma.TransactionClient, kind: QualityKind, where: { id: string; projectId: string }): PromiseLike<StoredSource | null> {
  const select = { ...qualityAutomationSource, automationCode: true } as const;
  switch (kind) {
    case 'availability': return db.monitor.findFirst({ where, select: { ...select, ...monitorHttpCheckFields, active: true, timeoutMs: true, intervalMinutes: true } });
    case 'lighthouse': return db.performanceAudit.findFirst({ where, select });
    case 'load': return db.loadTest.findFirst({ where, select: { ...select, stages: true } });
    case 'ux': return db.uxAudit.findFirst({ where, select });
  }
}

export async function renderQualityConfiguration(kind: QualityKind, source: Source, target: URL, context: UxAgentContext) {
  const code = await renderAgentFile(kind, source, target, context);
  if (!await checkModuleSyntax(code)) throw new QualityReviewRequired('El archivo generado no pasó la validación de sintaxis.');
  return { automationSignature: qualityConfigurationSignature(kind, source), automationCode: code, automationReview: null };
}

function savePreparation(
  db: Prisma.TransactionClient, kind: QualityKind, id: string, source: Source,
  data: { automationSignature: string; automationCode: string | null; automationReview: string | null },
) {
  const where = {
    id, projectId: source.projectId, url: source.url, environmentId: source.environmentId,
    automationSignature: source.automationSignature, automationReview: source.automationReview,
  };
  switch (kind) {
    case 'availability': return db.monitor.updateMany({
      where: { ...where, timeoutMs: source.timeoutMs, intervalMinutes: source.intervalMinutes,
        method: source.method, minStatus: source.minStatus, maxStatus: source.maxStatus }, data,
    });
    case 'lighthouse': return db.performanceAudit.updateMany({ where, data });
    case 'load': return db.loadTest.updateMany({
      where: { ...where, stages: { equals: (source.stages ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull } }, data,
    });
    case 'ux': return db.uxAudit.updateMany({ where, data });
  }
}

async function qualityFile(
  db: Prisma.TransactionClient, kind: QualityKind, id: string, projectId: string, context?: UxAgentContext,
): Promise<QualityFile> {
  const where = { id, projectId };
  const source = await readQualityExecutionSource(db, kind, where);
  if (!source) throw new NotFoundException('Prueba de calidad no encontrada.');

  const metadata = qualityAutomationStatus(kind, source);
  if (metadata.prepared) {
    if (context) return metadata;
    const code = source.automationCode ?? await renderAgentFile(kind, source, authorizedTarget(source));
    return { ...metadata, code };
  }
  if (!context) throw new NotFoundException('El código de esta prueba está pendiente de generación.');

  const signature = qualityConfigurationSignature(kind, source);
  let code: string | null = null;
  let reviewReason: string | null = null;
  try {
    const rendered = await renderAgentFile(kind, source, authorizedTarget(source), context);
    if (!await checkModuleSyntax(rendered)) throw new QualityReviewRequired('El archivo generado no pasó la validación de sintaxis.');
    code = rendered;
  } catch (error) {
    if (!(error instanceof QualityReviewRequired)) throw error;
    reviewReason = error.message;
  }

  const latest = await readQualityExecutionSource(db, kind, where);
  if (!latest) throw new NotFoundException('Prueba de calidad no encontrada.');
  if (qualityConfigurationSignature(kind, latest) !== signature) throw new ConflictException('La configuración cambió. Vuelve a generar el archivo.');
  const latestMetadata = qualityAutomationStatus(kind, latest);
  if (latestMetadata.prepared) return latestMetadata;

  const updated = await savePreparation(db, kind, id, latest, {
    automationSignature: signature, automationCode: code, automationReview: reviewReason,
  });
  if (!updated.count) {
    const concurrent = await readQualityExecutionSource(db, kind, where);
    if (concurrent && qualityConfigurationSignature(kind, concurrent) === signature) {
      const concurrentMetadata = qualityAutomationStatus(kind, concurrent);
      if (concurrentMetadata.prepared || concurrentMetadata.reviewReason) return concurrentMetadata;
    }
    throw new ConflictException('La configuración cambió. Vuelve a generar el archivo.');
  }

  return qualityAutomationStatus(kind, { ...latest, automationSignature: signature, automationReview: reviewReason });
}

const preparations = new Map<string, Promise<QualityFile>>();

export async function qualityAutomationFile(
  db: Prisma.TransactionClient, projectId: string, rawKind: string, id: string, prepare?: UxAgentContext,
) {
  if (!Object.hasOwn(qualityTools, rawKind)) throw new NotFoundException('Tipo de prueba no encontrado.');
  const kind = rawKind as QualityKind;
  if (!prepare) return qualityFile(db, kind, id, projectId);

  const key = [projectId, kind, id].join(':');
  const existing = preparations.get(key);
  if (existing) return existing;
  const pending = qualityFile(db, kind, id, projectId, prepare).finally(() => preparations.delete(key));
  preparations.set(key, pending);
  return pending;
}

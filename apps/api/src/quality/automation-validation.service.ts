import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type AutomationValidation, type Environment } from '@prisma/client';
import { activePlan, hasRole, projectScope, type Workspace } from '../commerce/workspace.guard';
import { requireCapability } from '../commerce/plan-capabilities';
import { PrismaService } from '../prisma.service';
import { scenarioRunEnvironmentError, supportsScenarioWrites } from '../runs/environment-policy';
import { RunsService } from '../runs/runs.service';
import { validationScopeSignature } from '../runs/validation-scope';
import { currentAutomation } from '../scenarios/automation-agent';
import { isManualScenario } from '../scenarios/scenario-tags';
import { generatedCodeHealth } from './generated-code-health';

export const MAX_VALIDATION_CASES = 20;
const MAX_AGE_MS = 25 * 60 * 1000;
const WORKFLOW = 'validate-automation.yml';
const live = ['QUEUED', 'RUNNING'] as const;

type ValidationCase = { scenarioId: string; title: string; automationId: string; runId: string; blocked?: string };
type CaseStatus = 'pending' | 'passed' | 'failed' | 'blocked' | 'skipped';
type ValidationRun = {
  id: string;
  status: string;
  errorCode?: string | null;
  results: Array<{ status: string }>;
};

function integration() {
  const repository = process.env.AUTOQA_GITHUB_REPO?.trim() || 'haidert94/Auto-QA';
  const ref = process.env.AUTOQA_GITHUB_VALIDATION_REF?.trim() || 'main';
  const token = process.env.AUTOQA_GITHUB_VALIDATION_TOKEN?.trim();
  const key = process.env.AUTOQA_VALIDATION_SECRET?.trim();
  const configured = !!token && !!key && key.length >= 32 && /^[\w.-]+\/[\w.-]+$/.test(repository);
  return { repository, ref, token, key, configured };
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validEnvironment(env: Environment | null): env is Environment & { type: NonNullable<Environment['type']> } {
  return !!env?.type && supportsScenarioWrites(env.type) && !!env.baseUrl && !scenarioRunEnvironmentError(env);
}

function casesOf(job: AutomationValidation) {
  return job.cases as unknown as ValidationCase[];
}

function isLive(status: string) {
  return live.some(state => state === status);
}

function expired(job: AutomationValidation) {
  return isLive(job.status) && Date.now() - job.createdAt.getTime() >= MAX_AGE_MS;
}

function summarize(job: AutomationValidation, runs: readonly ValidationRun[]) {
  const catalog = new Map(runs.map(run => [run.id, run]));
  const status = expired(job) ? 'CANCELED' : job.status;
  const counts = { pending: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 };
  const cases = casesOf(job).map(item => {
    const run = catalog.get(item.runId);
    const result = run?.results[0]?.status;
    let outcome: CaseStatus = 'blocked';
    if (result === 'PASSED') outcome = 'passed';
    else if (result === 'FAILED') outcome = 'failed';
    else if (result === 'SKIPPED') outcome = 'skipped';
    else if (!item.blocked && (!run || isLive(run.status)) && isLive(status)) outcome = 'pending';
    counts[outcome]++;
    return { scenarioId: item.scenarioId, title: item.title, automationId: item.automationId,
      status: outcome, reason: item.blocked ?? (run?.errorCode === 'validation-compile-error'
        ? 'El código generado contiene un error de sintaxis TypeScript.' : null) };
  });
  return {
    id: job.id, status, counts, cases, version: job.version, createdAt: job.createdAt, completedAt: job.completedAt,
    environmentType: job.environmentType, environmentId: job.environmentId,
    reason: expired(job) ? 'La validación agotó el tiempo de espera.' : job.errorCode,
    workflowUrl: job.workflowRunId ? `https://github.com/${job.repository}/actions/runs/${job.workflowRunId}` : null,
  };
}

function concurrencyLimit(error: HttpException) {
  const response = error.getResponse();
  return typeof response === 'object' && 'code' in response && response.code === 'RUN_CONCURRENCY_LIMIT';
}

@Injectable()
export class AutomationValidationService {
  constructor(private readonly db: PrismaService, private readonly runs: RunsService) {}

  async list(projectId: string, workspace: Workspace) {
    const project = await this.requireProject(this.db, projectId, workspace);
    const [environments, scenarios, jobs] = await Promise.all([
      this.db.environment.findMany({ where: { projectId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      this.db.testScenario.findMany({
        where: { projectId, archivedAt: null },
        select: { id: true, title: true, tags: true, expectedResult: true, steps: true, automation: true },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
      }),
      this.db.automationValidation.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 15 }),
    ]);
    const playwright = scenarios.filter(scenario => !isManualScenario(scenario))
      .map(scenario => ({ scenario, automation: currentAutomation(scenario) }));
    const versions = new Map(playwright.flatMap(({ scenario, automation }) =>
      automation ? [[scenario.id, automation.id] as const] : []));
    const [results, codeHealth] = await Promise.all([
      this.readRuns(this.db, projectId, jobs.flatMap(casesOf)),
      generatedCodeHealth(this.db, projectId, playwright),
    ]);
    const history = jobs.map(job => ({
      ...summarize(job, results),
      currentVersion: casesOf(job).every(test => versions.get(test.scenarioId) === test.automationId),
    }));
    const ciValidation = history.find(item => item.currentVersion && item.completedAt && item.workflowUrl
      && (item.status === 'COMPLETED' || item.status === 'FAILED') && item.counts.passed + item.counts.failed > 0);
    return {
      configured: integration().configured,
      ready: project.status === 'READY',
      maxCases: MAX_VALIDATION_CASES,
      environments: environments.filter(validEnvironment).map(env => ({ id: env.id, type: env.type, readOnly: env.readOnly, baseUrl: env.baseUrl })),
      scenarios: scenarios.filter(item => versions.has(item.id)).map(({ id, title }) => ({ id, title })),
      history,
      codeHealth,
      ciValidationId: ciValidation?.id ?? null,
    };
  }

  async start(projectId: string, workspace: Workspace, input: { environmentId: string; scenarioIds: string[] }) {
    const settings = integration();
    if (!settings.configured) throw new ServiceUnavailableException('La integración de validación con GitHub Actions está pendiente de configuración.');
    const userId = workspace.userId;
    if (!userId || !workspace.organizationId) throw new ForbiddenException('La validación requiere una cuenta de la organización.');
    const job = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      const project = await this.requireProject(tx, projectId, workspace);
      if (project.status !== 'READY') throw new ConflictException('Completa el registro del proyecto antes de validarlo.');
      const concurrent = await tx.automationValidation.findFirst({
        where: { projectId, status: { in: [...live] }, createdAt: { gt: new Date(Date.now() - MAX_AGE_MS) } },
        select: { id: true },
      });
      if (concurrent) throw new ConflictException('Ya hay una validación en curso para este proyecto.');

      const environment = await tx.environment.findFirst({ where: { id: input.environmentId, projectId } });
      if (!validEnvironment(environment)) throw new BadRequestException('Selecciona un entorno de pruebas autorizado.');
      const scenarios = await tx.testScenario.findMany({
        where: { id: { in: input.scenarioIds }, projectId, archivedAt: null },
        select: { id: true, title: true, tags: true, expectedResult: true, steps: true, automation: true },
        orderBy: { id: 'asc' },
      });
      if (scenarios.length !== input.scenarioIds.length) throw new BadRequestException('Alguno de los escenarios ya no pertenece al proyecto.');
      const cases: ValidationCase[] = scenarios.map(scenario => {
        const prepared = currentAutomation(scenario);
        if (!prepared || isManualScenario(scenario)) throw new ConflictException('Prepara el código Playwright de los escenarios seleccionados.');
        return { scenarioId: scenario.id, title: scenario.title, automationId: prepared.id, runId: randomUUID() };
      });
      return tx.automationValidation.create({ data: {
        projectId, environmentId: environment.id, environmentType: environment.type,
        scopeSignature: validationScopeSignature(environment),
        createdByUserId: userId, repository: settings.repository, cases,
        version: hash(cases.map(({ scenarioId, automationId }) => [scenarioId, automationId])),
      } });
    });

    try {
      const response = await fetch(`https://api.github.com/repos/${settings.repository}/actions/workflows/${WORKFLOW}/dispatches`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + settings.token, Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'autoqa-automation-validation' },
        body: JSON.stringify({ ref: settings.ref, inputs: { validation_id: job.id } }),
      });
      if (!response.ok) throw new Error('dispatch failed');
    } catch {
      const failed = await this.db.automationValidation.updateMany({
        where: { id: job.id, status: 'QUEUED', workflowRunId: null },
        data: { status: 'FAILED', errorCode: 'GitHub Actions no confirmó el inicio.', completedAt: new Date() },
      });
      if (failed.count) throw new ServiceUnavailableException('GitHub Actions no confirmó el inicio de la validación.');
    }
    return { id: job.id };
  }

  async advance(validationId: string, authorization?: string, githubRun?: string) {
    const settings = integration();
    const supplied = Buffer.from(authorization ?? '');
    const expected = Buffer.from('Bearer ' + settings.key);
    if (!settings.configured || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)
      || !githubRun || !/^\d{1,20}$/.test(githubRun)) throw new ForbiddenException('Validación de GitHub no autorizada.');

    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AutomationValidation" WHERE id = ${validationId} FOR UPDATE`;
      let job = await tx.automationValidation.findUnique({ where: { id: validationId } });
      if (!job || job.repository !== settings.repository || (job.workflowRunId && job.workflowRunId !== githubRun)) {
        throw new NotFoundException('Validación de GitHub no encontrada.');
      }
      if (!job.workflowRunId && isLive(job.status)) job = await tx.automationValidation.update({
        where: { id: job.id }, data: { workflowRunId: githubRun, status: 'RUNNING' },
      });

      const cases = casesOf(job);
      const runs = await this.readRuns(tx, job.projectId, cases);
      if (expired(job)) job = await tx.automationValidation.update({
        where: { id: job.id }, data: { status: 'CANCELED', completedAt: new Date(), errorCode: 'La validación agotó el tiempo de espera.' },
      });
      if (!isLive(job.status)) return summarize(job, runs);
      if (runs.some(run => isLive(run.status))) return summarize(job, runs);

      const next = cases.find(item => !item.blocked && !runs.some(run => run.id === item.runId));
      if (next) {
        const workspace = await this.executionWorkspace(tx, job);
        const env = await tx.environment.findFirst({ where: { id: job.environmentId, projectId: job.projectId } });
        if (!workspace || !validEnvironment(env) || validationScopeSignature(env) !== job.scopeSignature) {
          job = await tx.automationValidation.update({ where: { id: job.id },
            data: { status: 'FAILED', completedAt: new Date(), errorCode: 'El entorno o los permisos cambiaron. Confirma una nueva validación.' } });
          return summarize(job, runs);
        }
        try {
          const run = await this.runs.create(job.projectId, next.scenarioId, {
            environmentId: env.id, automationId: next.automationId,
            writeAuthorizationAt: env.readOnly ? undefined : env.authorizedAt?.toISOString(),
          }, workspace, { tx, runId: next.runId, scopeSignature: job.scopeSignature });
          return summarize(job, [...runs, { ...run, results: [] }]);
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          if (concurrencyLimit(error)) return summarize(job, runs);
          next.blocked = error.message;
          job = await tx.automationValidation.update({ where: { id: job.id }, data: { cases } });
        }
      }

      const result = summarize(job, runs);
      if (result.counts.pending) return result;
      job = await tx.automationValidation.update({
        where: { id: job.id }, data: {
          status: result.counts.passed === cases.length ? 'COMPLETED' : 'FAILED', completedAt: new Date(),
        },
      });
      return summarize(job, runs);
    }, { timeout: 12000 });
  }

  private async readRuns(db: Prisma.TransactionClient, projectId: string, cases: ValidationCase[]) {
    if (!cases.length) return [];
    return db.testRun.findMany({
      where: { projectId, id: { in: cases.map(item => item.runId) } },
      select: { id: true, status: true, errorCode: true, results: { select: { status: true }, take: 1 } },
    });
  }

  private async requireProject(db: Prisma.TransactionClient, projectId: string, workspace: Workspace) {
    const project = await db.project.findFirst({
      where: { id: projectId, ...projectScope(workspace) }, select: { status: true },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    return project;
  }

  private async executionWorkspace(db: Prisma.TransactionClient, job: AutomationValidation) {
    const member = await db.organizationMember.findUnique({
      where: { userId: job.createdByUserId }, select: { organizationId: true, role: true },
    });
    if (!member || !hasRole(member.role, ['EDITOR'])) return null;
    const workspace = { ...member, userId: job.createdByUserId };
    const project = await db.project.findFirst({
      where: { id: job.projectId, ...projectScope(workspace), status: 'READY' }, select: { id: true },
    });
    if (!project) return null;
    try {
      requireCapability(await activePlan(db, member.organizationId), 'BROWSER_TESTS');
    } catch (error) {
      if (error instanceof ForbiddenException) return null;
      throw error;
    }
    return workspace;
  }
}

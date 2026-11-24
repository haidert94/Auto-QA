import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { DocumentsService } from '../documents/documents.service';
import { SCREENSHOT_READER, type ScreenshotReader } from '../exploration/screenshot-storage';
import { KEY_PATTERN } from '../exploration/s3-config';
import { normalizeUxReport } from '../ux/ux-evidence';
import { qualityError, readQualityResults, type AvailabilityCheck, type UxResultDetail } from './quality-results';
import { IcspService } from '../icsp/icsp.service';
import { computeIcsp } from '../icsp/icsp-calculator';
import { readQualitySuiteActivity } from '../scenarios/quality-suite-activity';
import { PrismaService } from '../prisma.service';
import { ACTIVE_RUN_STATUSES, REPORT_WHILE_RUNNING, REPORT_WITHOUT_RUNS } from '../runs/run-report-policy';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly icsp: IcspService,
    @Inject(SCREENSHOT_READER) private readonly evidence: ScreenshotReader,
  ) {}

  async quality(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return readQualityResults(this.prisma, projectId);
  }

  async availabilityHistory(projectId: string, id: string, workspace: Workspace): Promise<AvailabilityCheck[]> {
    await this.ensureProject(projectId, workspace);
    const monitor = await this.prisma.monitor.findFirst({
      where: { projectId, id },
      select: { checks: { where: { status: { in: ['UP', 'DOWN'] } }, orderBy: [{ at: 'desc' }, { id: 'asc' }], take: 100,
        select: { id: true, at: true, status: true, httpStatus: true, latencyMs: true, errorCode: true } } },
    });
    if (!monitor) throw new NotFoundException('Monitor no encontrado.');
    return monitor.checks.map(({ at, errorCode, ...check }) => ({ ...check, at: at.toISOString(), error: qualityError(errorCode) }));
  }

  async uxDetails(projectId: string, id: string, workspace: Workspace): Promise<UxResultDetail> {
    const data = await this.readUxEvidence(projectId, id, workspace);
    const report = normalizeUxReport(data);
    const findings = report.findings.map(({ summary, recommendation, severity }) => ({ summary, recommendation, severity }));
    return { summary: report.overallSummary, findings, hasScreenshot: this.uxScreenshotKey(data) !== null };
  }

  async uxScreenshot(projectId: string, id: string, workspace: Workspace) {
    const data = await this.readUxEvidence(projectId, id, workspace);
    const key = this.uxScreenshotKey(data);
    const file = key ? await this.evidence.read(key) : null;
    if (!file) throw new NotFoundException('Captura UX no disponible.');
    return file;
  }

  private uxScreenshotKey(data: Record<string, unknown>) {
    return typeof data.screenshotKey === 'string' && KEY_PATTERN.test(data.screenshotKey) ? data.screenshotKey : null;
  }

  private async readUxEvidence(projectId: string, id: string, workspace: Workspace): Promise<Record<string, unknown>> {
    await this.ensureProject(projectId, workspace);
    const audit = await this.prisma.uxAudit.findFirst({
      where: { projectId, id, status: { in: ['COMPLETED', 'FAILED'] } },
      select: { reportDetails: true, screenshotKey: true, reportKey: true },
    });
    const details = audit?.reportDetails;
    if (audit && details && typeof details === 'object' && !Array.isArray(details)) {
      return { ...details, screenshotKey: audit.screenshotKey };
    }
    const bytes = audit?.reportKey ? await this.evidence.read(audit.reportKey) : null;
    if (bytes && bytes.byteLength <= 1024 * 1024) {
      try {
        const payload: unknown = JSON.parse(bytes.toString('utf8'));
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload as Record<string, unknown>;
      } catch { /* An incomplete stored report has no detail to display. */ }
    }
    throw new NotFoundException('Detalle de UX no disponible.');
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ...projectScope(workspace) }, select: { id: true },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }

  async export(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ...projectScope(workspace) },
      select: {
        id: true, name: true, description: true, status: true,
        createdAt: true, updatedAt: true, organizationId: true,
      },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');

    const active = await this.prisma.testRun.findFirst({
      where: { projectId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      select: { id: true },
    });
    if (active || (await readQualitySuiteActivity(this.prisma, projectId)).length) throw new ConflictException(REPORT_WHILE_RUNNING);

    const icspInput = await this.icsp.collect(projectId, true);
    if (!icspInput.runs.length) throw new ConflictException(REPORT_WITHOUT_RUNS);
    const { ipa, analysis } = await this.documents.report(projectId);
    const icsp = computeIcsp(icspInput);

    // Mapeo de trazabilidad por requisito: lista cada escenario y el último
    // resultado conocido (si existe), para ver la cadena de un vistazo.
    const scenariosByReq = new Map<string, typeof icspInput.scenarios>();
    for (const s of icspInput.scenarios) {
      if (!s.requirementId) continue;
      const list = scenariosByReq.get(s.requirementId) ?? [];
      list.push(s);
      scenariosByReq.set(s.requirementId, list);
    }
    const runsByScenario = new Map<string, typeof icspInput.runs>();
    for (const run of icspInput.runs) {
      if (!run.scenarioId) continue;
      const list = runsByScenario.get(run.scenarioId) ?? [];
      list.push(run);
      runsByScenario.set(run.scenarioId, list);
    }
    const traceability = icspInput.requirements.map(req => {
      const scenarios = (scenariosByReq.get(req.id) ?? []).map(s => {
        const runs = runsByScenario.get(s.id) ?? [];
        const lastRun = runs[0] ?? null;
        const lastResult = lastRun?.results[0] ?? null;
        return { id: s.id, title: s.title, lastRun: lastRun ? {
          id: lastRun.id, status: lastRun.status, createdAt: lastRun.createdAt, result: lastResult,
        } : null };
      });
      return { requirement: req, scenarios };
    });

    return {
      generatedAt: new Date().toISOString(),
      project,
      analysis: analysis ? { id: analysis.id, createdAt: analysis.createdAt, warnings: analysis.warnings } : null,
      ipa,
      icsp,
      traceability,
    };
  }
}

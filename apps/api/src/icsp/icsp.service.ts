import { Injectable, NotFoundException } from '@nestjs/common';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { REPORTABLE_RUN_STATUSES, REPORT_SCENARIO_SCOPE } from '../runs/run-report-policy';
import { readQualityScenarios } from '../scenarios/quality-scenarios';
import { computeIcsp, type IcspInput, type IcspReport, type IcspRun } from './icsp-calculator';

const RECENT_WINDOW_DAYS = 30;

@Injectable()
export class IcspService {
  constructor(private readonly prisma: PrismaService) {}

  async current(projectId: string, workspace: Workspace): Promise<IcspReport & { generatedAt: string }> {
    await this.ensureProject(projectId, workspace);
    const input = await this.collect(projectId);
    const report = computeIcsp(input);
    return { ...report, generatedAt: input.now.toISOString() };
  }

  async history(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const rows = await this.prisma.qualityAssessment.findMany({
      where: { projectId, type: 'TEST_QUALITY' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, score: true, createdAt: true, details: true },
    });
    return rows.map((row, index) => {
      const next = rows[index + 1];
      const delta = next && typeof row.score === 'number' && typeof next.score === 'number'
        ? row.score - next.score : null;
      const details = row.details as { counts?: Record<string, number> } | null;
      return {
        id: row.id, score: row.score, createdAt: row.createdAt, delta,
        counts: details?.counts ?? null,
      };
    });
  }

  async snapshot(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const input = await this.collect(projectId);
    const report = computeIcsp(input);
    const row = await this.prisma.qualityAssessment.create({
      data: {
        projectId,
        type: 'TEST_QUALITY',
        score: report.score,
        details: report as unknown as Parameters<typeof this.prisma.qualityAssessment.create>[0]['data']['details'],
      },
      select: { id: true, score: true, createdAt: true },
    });
    return row;
  }

  // Expuesto para que reports/ReportsService consuma ICSP sin duplicar la
  // lectura de BD.
  async collect(projectId: string, reportableOnly = false): Promise<IcspInput> {
    const [requirements, scenarios, runs, qualityScenarios] = await Promise.all([
      this.prisma.requirement.findMany({
        where: { projectId },
        select: { id: true, title: true, externalKey: true },
        orderBy: [{ externalKey: 'asc' }, { title: 'asc' }],
      }),
      this.prisma.testScenario.findMany({
        where: { projectId, archivedAt: null },
        select: { id: true, title: true, requirementId: true },
        orderBy: { title: 'asc' },
      }),
      this.prisma.testRun.findMany({
        where: {
          projectId, ...REPORT_SCENARIO_SCOPE,
          status: reportableOnly ? { in: [...REPORTABLE_RUN_STATUSES] } : { not: 'CANCELED' },
        },
        select: {
          id: true, scenarioId: true, status: true, createdAt: true,
          results: { where: { scenario: { archivedAt: null } }, select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      readQualityScenarios(this.prisma, projectId),
    ]);

    const qualityRuns = qualityScenarios.flatMap(({ id, quality }): IcspRun[] => {
      if (!quality.hasResult || !quality.runAt) return [];
      const failed = quality.status.tone === 'failed' || quality.availabilityVerdict === 'FAILED';
      const outcome = quality.availabilityVerdict ?? (quality.result !== null ? 'MEASURED' : null);
      return [{
        id,
        scenarioId: id,
        status: failed ? 'FAILED' : 'COMPLETED',
        createdAt: new Date(quality.runAt),
        results: outcome ? [{ id, status: outcome }] : [],
      }];
    });

    return {
      now: new Date(), recentWindowDays: RECENT_WINDOW_DAYS, requirements,
      scenarios: [...scenarios, ...qualityScenarios.map(({ id, title, requirementId }) => ({ id, title, requirementId }))],
      runs: [...runs, ...qualityRuns].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    };
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

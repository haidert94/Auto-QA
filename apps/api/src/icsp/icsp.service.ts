import { Injectable, NotFoundException } from '@nestjs/common';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { FINAL_RUN_STATUSES } from '../runs/run-report-policy';
import { computeIcsp, type IcspInput, type IcspReport } from './icsp-calculator';

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
  async collect(projectId: string, finalizedOnly = false): Promise<IcspInput> {
    const [requirements, scenarios, runs] = await Promise.all([
      this.prisma.requirement.findMany({
        where: { projectId },
        select: { id: true, title: true, externalKey: true },
        orderBy: [{ externalKey: 'asc' }, { title: 'asc' }],
      }),
      this.prisma.testScenario.findMany({
        where: { projectId },
        select: { id: true, title: true, requirementId: true },
        orderBy: { title: 'asc' },
      }),
      this.prisma.testRun.findMany({
        where: { projectId, ...(finalizedOnly ? { status: { in: [...FINAL_RUN_STATUSES] } } : {}) },
        select: {
          id: true, scenarioId: true, status: true, createdAt: true,
          results: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);
    return { now: new Date(), recentWindowDays: RECENT_WINDOW_DAYS, requirements, scenarios, runs };
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

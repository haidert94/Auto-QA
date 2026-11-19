import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { DocumentsService } from '../documents/documents.service';
import { IcspService } from '../icsp/icsp.service';
import { computeIcsp } from '../icsp/icsp-calculator';
import { PrismaService } from '../prisma.service';
import { ACTIVE_RUN_STATUSES, REPORT_WHILE_RUNNING, REPORT_WITHOUT_RUNS } from '../runs/run-report-policy';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly icsp: IcspService,
  ) {}

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
    if (active) throw new ConflictException(REPORT_WHILE_RUNNING);

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

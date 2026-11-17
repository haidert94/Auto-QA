import { Injectable, NotFoundException } from '@nestjs/common';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class IpaService {
  constructor(private readonly prisma: PrismaService, private readonly documents: DocumentsService) {}

  // IPA actual (recalculado en el momento). Reutiliza el report() del módulo
  // de documentos para no duplicar reglas: la fuente de verdad del cálculo
  // sigue siendo readiness().
  async current(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const { ipa, analysis } = await this.documents.report(projectId);
    return { ipa, analysisId: analysis?.id ?? null, generatedAt: new Date().toISOString() };
  }

  // Histórico persistido: cada analyze() guarda un QualityAssessment con el
  // details completo del IPA (incluye anchors y blockers). Devolvemos las
  // últimas 20 con la diferencia de score respecto a la previa.
  async history(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const rows = await this.prisma.qualityAssessment.findMany({
      where: { projectId, type: 'READINESS' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, score: true, createdAt: true, analysisId: true, details: true },
    });
    const items = rows.map((row, index) => {
      const next = rows[index + 1];
      const delta = next && typeof next.score === 'number' && typeof row.score === 'number' ? row.score - next.score : null;
      const details = row.details as { status?: string; blockers?: string[] } | null;
      return {
        id: row.id, analysisId: row.analysisId, score: row.score,
        status: details?.status ?? null,
        blockers: Array.isArray(details?.blockers) ? details.blockers : [],
        createdAt: row.createdAt, delta,
      };
    });
    return items;
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

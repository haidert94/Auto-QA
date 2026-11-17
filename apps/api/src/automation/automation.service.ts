import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { CreateAutomationDto } from './dto/create-automation.dto';

const MAX_DOC_BYTES = 5 * 1024 * 1024;

@Injectable()
export class AutomationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, dto: CreateAutomationDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    let urlObj: URL;
    try { urlObj = new URL(dto.url); }
    catch { throw new BadRequestException('La URL no es válida.'); }
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new BadRequestException('La URL debe ser http(s).');
    }

    const docs = (dto.documents ?? []).map((doc, index) => {
      const bytes = Buffer.from(doc.base64, 'base64');
      if (bytes.length === 0) throw new BadRequestException('Documento ' + (index + 1) + ' vacío o base64 inválido.');
      if (bytes.length > MAX_DOC_BYTES) {
        throw new BadRequestException('Documento ' + doc.filename + ' supera los 5 MB.');
      }
      return { filename: doc.filename, base64: bytes.toString('base64') };
    });

    const runKey = workspace.organizationId ? 'auto-' + randomUUID() : null;
    const inputs = {
      url: urlObj.toString(),
      description: dto.description?.trim() || null,
      ownerLabel: dto.ownerLabel?.trim() || null,
      hasCredentials: !!dto.credentialsHint?.trim(),
      documents: docs,
    };

    return this.prisma.automationJob.create({
      data: {
        projectId,
        status: 'QUEUED',
        stage: 'pending',
        inputs: inputs as unknown as Prisma.InputJsonValue,
        runKey,
        createdByUserId: workspace.userId ?? null,
      },
      select: { id: true, status: true, stage: true, createdAt: true },
    });
  }

  async list(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.automationJob.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, status: true, stage: true, errorCode: true,
        startedAt: true, completedAt: true, createdAt: true,
      },
    });
  }

  async get(projectId: string, jobId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const job = await this.prisma.automationJob.findFirst({
      where: { id: jobId, projectId },
      select: {
        id: true, status: true, stage: true, errorCode: true,
        startedAt: true, completedAt: true, createdAt: true,
        inputs: true, steps: true, result: true,
      },
    });
    if (!job) throw new NotFoundException('Automatización no encontrada.');
    // Antes de devolver, recorta los base64 de los documentos de entrada
    // para no mandar MBs al cliente.
    const inputs = job.inputs as { documents?: Array<{ filename: string; base64?: string }> } | null;
    if (inputs && Array.isArray(inputs.documents)) {
      inputs.documents = inputs.documents.map(d => ({ filename: d.filename }));
    }
    return job;
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...workspace }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

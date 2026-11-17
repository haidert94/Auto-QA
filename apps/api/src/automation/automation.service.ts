import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { SelectTestsDto } from './dto/select-tests.dto';
import { TEST_TYPE_META, type AutomationTestType } from './test-types';

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

  // Registra la selección de tipos de prueba y re-encola el job para que
  // el worker (commit C) lance los agentes de generación. Bloquea tipos
  // que no estén en el plan del cliente.
  async select(projectId: string, jobId: string, dto: SelectTestsDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const job = await this.prisma.automationJob.findFirst({
      where: { id: jobId, projectId },
      select: { id: true, status: true, stage: true, inputs: true },
    });
    if (!job) throw new NotFoundException('Automatización no encontrada.');
    if (job.stage !== 'review-ready') {
      throw new BadRequestException('La automatización no está en estado "review-ready".');
    }

    if (workspace.organizationId) {
      const available = await this.capabilitiesForOrg(workspace.organizationId);
      const blocked = dto.types.filter(t => !available.has(TEST_TYPE_META[t].capability));
      if (blocked.length) {
        throw new ForbiddenException({
          message: 'Tu plan no incluye uno o más tipos seleccionados.',
          blocked,
        });
      }
    }

    const inputs = { ...(job.inputs as Record<string, unknown>), selection: dto.types };
    await this.prisma.automationJob.update({
      where: { id: jobId },
      data: {
        inputs: inputs as unknown as Prisma.InputJsonValue,
        status: 'QUEUED',
        stage: 'selection-done',
        completedAt: null,
      },
    });
    return { message: 'Selección guardada. Los agentes comenzarán la generación.' };
  }

  // Devuelve los tipos de prueba y si el plan del workspace los incluye.
  // La UI lo usa para pintar los checkboxes bloqueados.
  async availableTypes(workspace: Workspace) {
    if (!workspace.organizationId) {
      return Object.entries(TEST_TYPE_META).map(([code, meta]) => ({
        code: code as AutomationTestType, label: meta.label, description: meta.description, available: true,
      }));
    }
    const available = await this.capabilitiesForOrg(workspace.organizationId);
    return Object.entries(TEST_TYPE_META).map(([code, meta]) => ({
      code: code as AutomationTestType,
      label: meta.label,
      description: meta.description,
      available: available.has(meta.capability),
    }));
  }

  private async capabilitiesForOrg(organizationId: string): Promise<Set<string>> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: { include: { capabilities: true } } },
    });
    const caps = subscription?.plan?.capabilities ?? [];
    return new Set(
      caps.filter(c => c.availability !== 'NOT_INCLUDED').map(c => c.code as string),
    );
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...workspace }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../documents/document-storage';
import { currentScenarioRequirements } from '../documents/document-records';
import { PrismaService } from '../prisma.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { SelectTestsDto } from './dto/select-tests.dto';
import { ALL_TEST_TYPES, TEST_TYPE_META, type AutomationTestType } from './test-types';

const MAX_DOC_BYTES = 5 * 1024 * 1024;

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  async create(projectId: string, dto: CreateAutomationDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    let urlObj: URL;
    try { urlObj = new URL(dto.url); }
    catch { throw new BadRequestException('La URL no es válida.'); }
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new BadRequestException('La URL debe ser http(s).');
    }

    let analysisId: string | undefined;
    if (dto.documentTestTypes) {
      if (dto.documents?.length) throw new BadRequestException('Usa los documentos guardados en Datos para esta selección.');
      const marked = await this.documentTestTypes(projectId);
      if (marked.size !== dto.documentTestTypes.length || !dto.documentTestTypes.every(type => marked.has(type))) {
        throw new ConflictException('Los tipos marcados en Datos cambiaron. Abre de nuevo la confirmación.');
      }
      await this.checkPlanTypes(dto.documentTestTypes, workspace.organizationId);
      const analysis = await currentScenarioRequirements(this.prisma, projectId);
      if (!analysis?.requirements.length) {
        throw new ConflictException('Analiza los documentos y confirma al menos un requisito verificable.');
      }
      analysisId = analysis.id;
    }

    let docs: Array<{ filename: string; base64: string }>;
    if (analysisId) {
      docs = [];
    } else if (dto.documents && dto.documents.length > 0) {
      // El wizard puede inyectar los documentos como base64 (compatibilidad
      // con el flujo original del Automate).
      docs = dto.documents.map((doc, index) => {
        const bytes = Buffer.from(doc.base64, 'base64');
        if (bytes.length === 0) throw new BadRequestException('Documento ' + (index + 1) + ' vacío o base64 inválido.');
        if (bytes.length > MAX_DOC_BYTES) {
          throw new BadRequestException('Documento ' + doc.filename + ' supera los 5 MB.');
        }
        return { filename: doc.filename, base64: bytes.toString('base64') };
      });
    } else {
      docs = await this.loadProjectDocuments(projectId);
    }

    const runKey = workspace.organizationId ? 'auto-' + randomUUID() : null;
    const inputs = {
      url: urlObj.toString(),
      description: dto.description?.trim() || null,
      ownerLabel: dto.ownerLabel?.trim() || null,
      hasCredentials: !!dto.credentialsHint?.trim(),
      documents: docs,
      ...(analysisId ? { documentAnalysisId: analysisId } : {}),
      ...(dto.documentTestTypes ? { documentTestTypes: dto.documentTestTypes } : {}),
    };

    return this.prisma.automationJob.create({
      data: {
        projectId,
        status: analysisId ? 'COMPLETED' : 'QUEUED',
        stage: analysisId ? 'review-ready' : 'pending',
        completedAt: analysisId ? new Date() : undefined,
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

    const currentInputs = job.inputs as Record<string, unknown>;
    const confirmed = currentInputs.documentTestTypes;
    if (Array.isArray(confirmed) && (confirmed.length !== dto.types.length || !dto.types.every(type => confirmed.includes(type)))) {
      throw new ConflictException('La selección debe coincidir con los tipos confirmados.');
    }
    await this.checkPlanTypes(dto.types, workspace.organizationId);

    const inputs = { ...currentInputs, selection: dto.types };
    const queue = async (tx: Prisma.TransactionClient) => {
      const result = await tx.automationJob.updateMany({
        where: { id: jobId, projectId, stage: 'review-ready' },
        data: {
          inputs: inputs as unknown as Prisma.InputJsonValue,
          status: 'QUEUED',
          stage: 'selection-done',
          completedAt: null,
        },
      });
      if (result.count !== 1) throw new ConflictException('La automatización ya fue enviada.');
    };

    if (Array.isArray(confirmed)) {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        const active = await tx.automationJob.findFirst({
          where: { projectId, status: { in: ['QUEUED', 'RUNNING'] }, stage: { in: ['selection-done', 'generating'] } },
          select: { id: true },
        });
        if (active) throw new ConflictException('Ya se están generando casos para este proyecto.');
        await queue(tx);
      });
    } else {
      await queue(this.prisma);
    }
    return { message: 'Selección guardada. Los agentes comenzarán la generación.' };
  }

  async availableTypes(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const [selected, plan] = await Promise.all([
      this.documentTestTypes(projectId),
      workspace.organizationId ? this.capabilitiesForOrg(workspace.organizationId) : null,
    ]);
    return ALL_TEST_TYPES.map(code => ({
      code, label: TEST_TYPE_META[code].label, description: TEST_TYPE_META[code].description,
      available: !plan || plan.available.has(TEST_TYPE_META[code].capability),
      selectedInDocuments: selected.has(code),
    }));
  }

  private async documentTestTypes(projectId: string) {
    const docs = await this.prisma.document.findMany({
      where: { projectId, removedAt: null, versions: { some: { uploadedAt: { not: null }, storageKey: { not: null } } } },
      select: { testTypes: true },
    });
    const codes = new Set(docs.flatMap(doc => doc.testTypes));
    return new Set(ALL_TEST_TYPES.filter(type => codes.has(type)));
  }

  private async checkPlanTypes(types: AutomationTestType[], organizationId: string | null) {
    if (!organizationId) return;
    const { available } = await this.capabilitiesForOrg(organizationId);
    const blocked = types.filter(type => !available.has(TEST_TYPE_META[type].capability));
    if (blocked.length) {
      throw new ForbiddenException({ message: 'Tu plan no incluye uno o más tipos seleccionados.', blocked });
    }
  }

  private async capabilitiesForOrg(organizationId: string): Promise<{ available: Set<string> }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: { include: { capabilities: true } } },
    });
    const caps = subscription?.plan?.capabilities ?? [];
    return {
      available: new Set(caps.filter(c => c.availability !== 'NOT_INCLUDED').map(c => c.code as string)),
    };
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }

  // Lee los documentos activos del proyecto desde el storage y los devuelve
  // como base64. Los documentos muy grandes se saltan con un warning
  // implícito (el runner los ignora igual). Un fallo de lectura por archivo
  // no aborta el resto: el agente puede trabajar con lo que haya.
  private async loadProjectDocuments(projectId: string): Promise<Array<{ filename: string; base64: string }>> {
    const docs = await this.prisma.document.findMany({
      where: { projectId, removedAt: null },
      include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
    });
    const loaded: Array<{ filename: string; base64: string }> = [];
    for (const doc of docs) {
      const version = doc.versions[0];
      if (!version?.storageKey) continue;
      if (version.size && version.size > MAX_DOC_BYTES) continue;
      try {
        const bytes = await this.storage.get(version.storageKey);
        if (bytes.length === 0 || bytes.length > MAX_DOC_BYTES) continue;
        loaded.push({ filename: doc.filename, base64: bytes.toString('base64') });
      } catch {
        // El worker puede continuar con un subset; no abortamos el job.
      }
    }
    return loaded;
  }
}

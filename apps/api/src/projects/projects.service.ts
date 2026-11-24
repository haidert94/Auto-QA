import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SecretCipher } from '../commerce/secret-cipher';
import { activePlan, projectScope, type Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import { getMissingRequirements, prepareOnboarding } from './onboarding';
import { parseBaseUrl } from './scope';
import { parseStorageState, summarizeStorageState, type StorageStatePublic } from './storage-state';

const environments = {
  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
} satisfies Prisma.Project$environmentsArgs;

const includeOnboarding = {
  environments,
  roles: { orderBy: { name: 'asc' } },
} satisfies Prisma.ProjectInclude;

type ProjectRecord = Prisma.ProjectGetPayload<{ include: typeof includeOnboarding }>;
type EnvironmentData = ReturnType<typeof prepareOnboarding>['environments'][number]['data'];

function redactEnvironment(environment: unknown) {
  const source = environment as Record<string, unknown> & {
    credentialCipher?: unknown;
    storageStateCipher?: unknown;
    storageStateLabel?: unknown;
    storageStateUploadedAt?: unknown;
    storageStateExpiresAt?: unknown;
  };
  const { credentialCipher, storageStateCipher, storageStateLabel, storageStateUploadedAt, storageStateExpiresAt, ...rest } = source;
  return {
    ...rest,
    hasCredentials: !!credentialCipher,
    // Nunca exponemos el blob cifrado al cliente. Solo metadatos: label, fechas
    // y que exista o no. El blob solo sale del servidor al worker, descifrado,
    // en el workdir temporal de un run.
    storageState: storageStateCipher ? {
      label: typeof storageStateLabel === 'string' ? storageStateLabel : null,
      uploadedAt: storageStateUploadedAt instanceof Date ? storageStateUploadedAt.toISOString() : null,
      expiresAt: storageStateExpiresAt instanceof Date ? storageStateExpiresAt.toISOString() : null,
    } : null,
  };
}

function describeProject<T extends ProjectRecord>(project: T) {
  return {
    ...project,
    environments: project.environments.map(redactEnvironment),
    missingRequirements: getMissingRequirements(project, project.environments, project.roles),
  };
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService, private readonly cipher: SecretCipher) {}

  private environmentWrite(data: EnvironmentData) {
    const { credentials, ...rest } = data;
    const base = { ...rest, testData: data.testData ?? Prisma.DbNull };
    if (credentials === undefined) return base;
    if (credentials === null) return { ...base, credentialUser: null, credentialCipher: null };
    return {
      ...base,
      credentialUser: credentials.user,
      credentialCipher: this.cipher.encrypt(credentials.password),
    };
  }

  async list(workspace: Workspace) {
    // Incluimos conteos de TestRun COMPLETED y QualityAssessment (ICSP
    // snapshot) por proyecto para que el dashboard clasifique en
    // Borrador / En proceso / Listos sin tener que hacer N llamadas.
    const records = await this.prisma.project.findMany({
      where: projectScope(workspace),
      include: {
        environments,
        _count: {
          select: {
            runs: { where: { status: 'COMPLETED' } },
            assessments: { where: { type: 'TEST_QUALITY' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(project => ({
      ...project,
      environments: project.environments.map(redactEnvironment),
      completedRuns: project._count.runs,
      icspSnapshots: project._count.assessments,
    }));
  }

  async get(id: string, workspace: Workspace) {
    const project = await this.prisma.project.findUnique({
      where: { id, ...projectScope(workspace) },
      include: includeOnboarding,
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado');
    return { ...describeProject(project), documents: [] };
  }

  async create(dto: CreateProjectDto, workspace: Workspace) {
    const legacy = [dto.baseUrl, dto.environment, dto.authorizationConfirmed, dto.readOnly]
      .some(value => value !== undefined);
    if (legacy) {
      if (dto.environments !== undefined || dto.status === 'READY') {
        throw new BadRequestException('Usa environments para registrar la configuración completa');
      }
      if (!dto.baseUrl || !dto.environment || dto.readOnly === undefined || !dto.authorizationConfirmed) {
        throw new BadRequestException('El registro básico exige URL, entorno, modo de lectura y autorización');
      }
      const base = parseBaseUrl(dto.baseUrl);
      dto = {
        ...dto,
        environments: [{
          baseUrl: base.url,
          type: dto.environment,
          readOnly: dto.readOnly,
          authorizationConfirmed: true,
          allowedHosts: [base.host],
        }],
      };
    }

    const configuration = prepareOnboarding(dto, null);
    try {
      return await this.prisma.$transaction(async tx => {
        const organizationId = workspace.organizationId;
        if (organizationId) {
          await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
          const plan = await activePlan(tx, organizationId);
          if (configuration.roles.length > plan.maxRoles) throw new ConflictException('Superaste el límite de roles del plan.');
          if (await tx.project.count({ where: { organizationId, status: { not: 'ARCHIVED' } } }) >= plan.maxProjects) {
            throw new ConflictException('Superaste el límite de aplicaciones del plan.');
          }
        }
        const duplicate = await tx.project.findFirst({
          where: {
            organizationId: workspace.organizationId ?? null,
            name: { equals: configuration.project.name, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (duplicate) throw new ConflictException('Ya tienes una aplicación con ese nombre. Elige uno diferente.');
        const project = await tx.project.create({
          data: {
            ...configuration.project,
            ...(workspace.organizationId && { organization: { connect: { id: workspace.organizationId } } }),
            ...(workspace.userId && { owner: { connect: { id: workspace.userId } } }),
            executionSettings: configuration.executionSettings ?? Prisma.DbNull,
            environments: { create: configuration.environments.map(({ data }) => this.environmentWrite(data)) },
            roles: { create: configuration.roles },
          },
          include: includeOnboarding,
        });
        return describeProject(project);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya tienes una aplicación con ese nombre. Elige uno diferente.');
      }
      throw error;
    }
  }

  async remove(id: string, workspace: Workspace) {
    const where = { id, ...projectScope(workspace) };
    try {
      return await this.prisma.$transaction(async tx => {
        const project = await tx.project.findUnique({ where, select: { id: true } });
        if (!project) throw new NotFoundException('Proyecto no encontrado.');

        // Bloquea vínculos nuevos al proyecto mientras se borran sus ejecuciones.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE
        `;
        if (!locked.length) throw new NotFoundException('Proyecto no encontrado.');

        // Los resultados se eliminan con sus ejecuciones antes de borrar los escenarios.
        await tx.testRun.deleteMany({ where: { projectId: project.id } });
        const deleted = await tx.project.deleteMany({ where });
        if (!deleted.count) throw new NotFoundException('Proyecto no encontrado.');
        return { id, removed: true };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') throw new ConflictException('No se pudo eliminar el proyecto porque todavía tiene registros vinculados.');
        if (error.code === 'P2034') throw new ConflictException('El proyecto cambió durante el borrado. Vuelve a intentarlo.');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProjectDto, workspace: Workspace) {
    const previous = await this.prisma.project.findUnique({ where: { id, ...projectScope(workspace) }, include: { environments, _count: { select: { roles: true } } } });
    if (!previous) throw new NotFoundException('Proyecto no encontrado');
    if (previous.status === 'ARCHIVED') throw new ConflictException('El proyecto está archivado');
    if (previous.revision !== dto.revision) {
      throw new ConflictException('El proyecto cambió. Recarga la página antes de guardar.');
    }

    const configuration = prepareOnboarding(dto, previous);
    if (workspace.organizationId) {
      const plan = await activePlan(this.prisma, workspace.organizationId);
      if (configuration.roles.length > Math.max(plan.maxRoles, previous._count.roles)) {
        throw new ConflictException('Superaste el límite de roles del plan.');
      }
    }
    const keptIds = configuration.environments.flatMap(entry => entry.id ? [entry.id] : []);
    const keptNames = configuration.roles.map(role => role.name);

    if (configuration.project.name.toLowerCase() !== previous.name.toLowerCase()) {
      const duplicate = await this.prisma.project.findFirst({
        where: {
          organizationId: previous.organizationId ?? null,
          name: { equals: configuration.project.name, mode: 'insensitive' },
          NOT: { id },
        },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('Ya tienes una aplicación con ese nombre. Elige uno diferente.');
    }

    try {
      const project = await this.prisma.project.update({
        where: { id, ...projectScope(workspace), revision: dto.revision },
        data: {
          ...configuration.project,
          revision: { increment: 1 },
          executionSettings: configuration.executionSettings ?? Prisma.DbNull,
          environments: {
            deleteMany: { id: { notIn: keptIds } },
            update: configuration.environments.flatMap(({ id: environmentId, data }) => environmentId
              ? [{ where: { id: environmentId }, data: this.environmentWrite(data) }]
              : []),
            create: configuration.environments.filter(entry => !entry.id).map(({ data }) => this.environmentWrite(data)),
          },
          roles: {
            deleteMany: { name: { notIn: keptNames } },
            upsert: configuration.roles.map(role => ({
              where: { projectId_name: { projectId: id, name: role.name } },
              create: role,
              update: role,
            })),
          },
        },
        include: includeOnboarding,
      });
      return describeProject(project);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new ConflictException('El proyecto cambió. Recarga la página antes de guardar.');
        if (error.code === 'P2002') throw new ConflictException('Ya tienes una aplicación con ese nombre. Elige uno diferente.');
      }
      throw error;
    }
  }

  // Guarda un storageState de Playwright cifrado con SecretCipher. El blob se
  // valida con parseStorageState antes de cifrar, y nunca vuelve al cliente:
  // la respuesta son solo metadatos (label, fechas, conteos).
  async setStorageState(
    projectId: string,
    environmentId: string,
    input: { storageState: unknown; label?: string | null; expiresAt?: string | null },
    workspace: Workspace,
  ): Promise<StorageStatePublic> {
    const environment = await this.loadScopedEnvironment(projectId, environmentId, workspace);
    let parsed;
    try { parsed = parseStorageState(input.storageState); }
    catch (error) {
      throw new BadRequestException((error as Error).message || 'storage-state-invalido');
    }
    const label = typeof input.label === 'string' ? input.label.trim().slice(0, 80) || null : null;
    const expiresAt = this.parseExpiresAt(input.expiresAt);
    const uploadedAt = new Date();
    const cipher = this.cipher.encrypt(JSON.stringify(parsed));
    await this.prisma.environment.update({
      where: { id: environment.id },
      data: {
        storageStateCipher: cipher,
        storageStateLabel: label,
        storageStateUploadedAt: uploadedAt,
        storageStateExpiresAt: expiresAt,
      },
    });
    return summarizeStorageState(parsed, { label, uploadedAt, expiresAt });
  }

  async clearStorageState(projectId: string, environmentId: string, workspace: Workspace): Promise<{ removed: true }> {
    const environment = await this.loadScopedEnvironment(projectId, environmentId, workspace);
    await this.prisma.environment.update({
      where: { id: environment.id },
      data: {
        storageStateCipher: null,
        storageStateLabel: null,
        storageStateUploadedAt: null,
        storageStateExpiresAt: null,
      },
    });
    return { removed: true };
  }

  private async loadScopedEnvironment(projectId: string, environmentId: string, workspace: Workspace) {
    // Un solo query valida tanto que el proyecto es del tenant como que el
    // entorno es de ese proyecto. No usamos findUnique por id del entorno
    // suelto: eso saltaría el scope del workspace.
    const env = await this.prisma.environment.findFirst({
      where: { id: environmentId, project: { id: projectId, ...projectScope(workspace) } },
      select: { id: true },
    });
    if (!env) throw new NotFoundException('Entorno no encontrado');
    return env;
  }

  private parseExpiresAt(raw: string | null | undefined): Date | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('expiresAt-invalido');
    if (parsed.getTime() <= Date.now()) throw new BadRequestException('expiresAt-en-el-pasado');
    return parsed;
  }
}

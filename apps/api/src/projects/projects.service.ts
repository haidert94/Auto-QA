import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { activePlan, type Workspace } from '../commerce/workspace.guard';
import { PrismaService } from '../prisma.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import { getMissingRequirements, prepareOnboarding } from './onboarding';
import { parseBaseUrl } from './scope';

const environments = {
  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
} satisfies Prisma.Project$environmentsArgs;

const includeOnboarding = {
  environments,
  roles: { orderBy: { name: 'asc' } },
} satisfies Prisma.ProjectInclude;

type ProjectRecord = Prisma.ProjectGetPayload<{ include: typeof includeOnboarding }>;
type EnvironmentData = ReturnType<typeof prepareOnboarding>['environments'][number]['data'];

function describeProject<T extends ProjectRecord>(project: T) {
  return {
    ...project,
    missingRequirements: getMissingRequirements(project, project.environments, project.roles),
  };
}

function environmentWrite(data: EnvironmentData) {
  return { ...data, testData: data.testData ?? Prisma.DbNull };
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(workspace: Workspace) {
    return this.prisma.project.findMany({ where: workspace, include: { environments }, orderBy: { createdAt: 'desc' } });
  }

  async get(id: string, workspace: Workspace) {
    const project = await this.prisma.project.findUnique({
      where: { id, ...workspace },
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
    return this.prisma.$transaction(async tx => {
      const organizationId = workspace.organizationId;
      if (organizationId) {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
        const plan = await activePlan(tx, organizationId);
        if (configuration.roles.length > plan.maxRoles) throw new ConflictException('Superaste el límite de roles del plan.');
        if (await tx.project.count({ where: { organizationId, status: { not: 'ARCHIVED' } } }) >= plan.maxProjects) {
          throw new ConflictException('Superaste el límite de aplicaciones del plan.');
        }
      }
      const project = await tx.project.create({
        data: {
          ...configuration.project,
          ...workspace,
          executionSettings: configuration.executionSettings ?? Prisma.DbNull,
          environments: { create: configuration.environments.map(({ data }) => environmentWrite(data)) },
          roles: { create: configuration.roles },
        },
        include: includeOnboarding,
      });
      return describeProject(project);
    });
  }

  async update(id: string, dto: UpdateProjectDto, workspace: Workspace) {
    const previous = await this.prisma.project.findUnique({ where: { id, ...workspace }, include: { environments, _count: { select: { roles: true } } } });
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

    try {
      const project = await this.prisma.project.update({
        where: { id, ...workspace, revision: dto.revision },
        data: {
          ...configuration.project,
          revision: { increment: 1 },
          executionSettings: configuration.executionSettings ?? Prisma.DbNull,
          environments: {
            deleteMany: { id: { notIn: keptIds } },
            update: configuration.environments.flatMap(({ id: environmentId, data }) => environmentId
              ? [{ where: { id: environmentId }, data: environmentWrite(data) }]
              : []),
            create: configuration.environments.filter(entry => !entry.id).map(({ data }) => environmentWrite(data)),
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('El proyecto cambió. Recarga la página antes de guardar.');
      }
      throw error;
    }
  }
}

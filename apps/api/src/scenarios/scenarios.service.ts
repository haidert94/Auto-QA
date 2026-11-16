import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { Workspace } from '../commerce/workspace.guard';
import { CreateScenarioDto, ScenarioStepDto, UpdateScenarioDto } from './dto/scenario.dto';
import { generateSpec, suggestedFilename, type GeneratorStep } from './playwright-generator';

function normalizeSteps(steps: ScenarioStepDto[]): Prisma.InputJsonValue {
  // Re-numeramos los ordinales en el servidor: el cliente puede enviar
  // cualquier orden pero persistimos 1..N para que el consumo sea estable.
  return steps
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((step, index) => ({
      ordinal: index + 1,
      action: step.action.trim(),
      data: step.data?.trim() || undefined,
      expected: step.expected?.trim() || undefined,
    })) as unknown as Prisma.InputJsonValue;
}

@Injectable()
export class ScenariosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.testScenario.findMany({
      where: { projectId },
      orderBy: { title: 'asc' },
      select: {
        id: true, title: true, requirementId: true, expectedResult: true,
        _count: { select: { results: true } },
      },
    });
  }

  async get(projectId: string, scenarioId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const scenario = await this.prisma.testScenario.findFirst({
      where: { id: scenarioId, projectId },
      include: {
        requirement: { select: { id: true, title: true, externalKey: true } },
      },
    });
    if (!scenario) throw new NotFoundException('Escenario no encontrado.');
    return scenario;
  }

  async create(projectId: string, dto: CreateScenarioDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('El título del escenario no puede estar vacío.');
    if (dto.requirementId) {
      await this.ensureRequirementInProject(projectId, dto.requirementId);
    }
    return this.prisma.testScenario.create({
      data: {
        projectId,
        title,
        requirementId: dto.requirementId ?? null,
        expectedResult: dto.expectedResult?.trim() || null,
        steps: normalizeSteps(dto.steps),
      },
      select: { id: true, title: true, requirementId: true, expectedResult: true },
    });
  }

  async update(projectId: string, scenarioId: string, dto: UpdateScenarioDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const existing = await this.prisma.testScenario.findFirst({ where: { id: scenarioId, projectId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Escenario no encontrado.');
    const data: Prisma.TestScenarioUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('El título del escenario no puede estar vacío.');
      data.title = title;
    }
    if (dto.requirementId !== undefined) {
      if (dto.requirementId === null) {
        data.requirement = { disconnect: true };
      } else {
        await this.ensureRequirementInProject(projectId, dto.requirementId);
        data.requirement = { connect: { id: dto.requirementId } };
      }
    }
    if (dto.expectedResult !== undefined) {
      data.expectedResult = dto.expectedResult === null ? null : (dto.expectedResult.trim() || null);
    }
    if (dto.steps !== undefined) {
      data.steps = normalizeSteps(dto.steps);
    }
    return this.prisma.testScenario.update({
      where: { id: scenarioId },
      data,
      select: { id: true, title: true, requirementId: true, expectedResult: true },
    });
  }

  async remove(projectId: string, scenarioId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const existing = await this.prisma.testScenario.findFirst({ where: { id: scenarioId, projectId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Escenario no encontrado.');
    await this.prisma.testScenario.delete({ where: { id: scenarioId } });
  }

  async generatePlaywright(projectId: string, scenarioId: string, workspace: Workspace) {
    const scenario = await this.get(projectId, scenarioId, workspace);
    // steps viene como Prisma.JsonValue; lo normalizamos defensivamente.
    const rawSteps: unknown[] = Array.isArray(scenario.steps) ? (scenario.steps as unknown[]) : [];
    const steps: GeneratorStep[] = rawSteps
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s, i) => ({
        ordinal: typeof s.ordinal === 'number' ? s.ordinal : i + 1,
        action: typeof s.action === 'string' ? s.action : '',
        data: typeof s.data === 'string' ? s.data : undefined,
        expected: typeof s.expected === 'string' ? s.expected : undefined,
      }))
      .filter(s => s.action.length > 0);
    const code = generateSpec({
      id: scenario.id,
      title: scenario.title,
      expectedResult: scenario.expectedResult,
      steps,
    });
    return { filename: suggestedFilename(scenario), code };
  }

  async listRequirements(projectId: string, workspace: Workspace) {
    // Catálogo liviano para poblar el dropdown del formulario.
    await this.ensureProject(projectId, workspace);
    return this.prisma.requirement.findMany({
      where: { projectId },
      orderBy: [{ externalKey: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true, externalKey: true },
    });
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...workspace }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }

  private async ensureRequirementInProject(projectId: string, requirementId: string) {
    const requirement = await this.prisma.requirement.findFirst({ where: { id: requirementId, projectId }, select: { id: true } });
    if (!requirement) throw new BadRequestException('El requisito no pertenece a este proyecto.');
  }
}

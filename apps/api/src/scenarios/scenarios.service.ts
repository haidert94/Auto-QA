import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AiRouter } from '../ai/ai-router';
import { PrismaService } from '../prisma.service';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { ACTIVE_RUN_STATUSES } from '../runs/run-report-policy';
import { CreateScenarioDto, ScenarioStepDto, UpdateScenarioDto } from './dto/scenario.dto';
import { isManualScenario, MANUAL_SCENARIO_MESSAGE } from './scenario-tags';
import { automationSignature, currentAutomation, prepareWithAgent, type PreparedAutomation } from './automation-agent';
import { ASSERTION_INSTRUCTION } from '../automation/agents/agent-types';
import { generateSpec, hasPlaywrightAssertion, readGeneratorSteps, suggestedFilename } from './playwright-generator';
import { buildTestSetPdf, buildTestSetXlsx, type ExportScenario } from './scenario-export';
import { groupSimilarSteps, type StepOccurrence } from './step-similarity';

type ScenarioForAutomation = Parameters<typeof currentAutomation>[0] & { id: string };

function renderPlaywright(scenario: ScenarioForAutomation, prepared: PreparedAutomation | null, notice?: string) {
  return {
    filename: suggestedFilename(scenario),
    code: generateSpec({
      id: scenario.id,
      title: scenario.title,
      expectedResult: scenario.expectedResult,
      steps: prepared?.steps ?? readGeneratorSteps(scenario.steps),
    }),
    automationId: prepared?.id ?? null,
    notice: notice ?? (prepared ? undefined : 'Vista previa por reglas. Usa Generar seleccionados para preparar el código con IA.'),
  };
}

type SuggestedScenario = { title: string; expectedResult?: string; steps: Array<{ action: string; data?: string; expected?: string }> };

function parseSuggestions(text: string): SuggestedScenario[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { scenarios?: unknown };
    if (!Array.isArray(parsed.scenarios)) return [];
    return parsed.scenarios
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .slice(0, 10)
      .map(s => ({
        title: typeof s.title === 'string' ? s.title.slice(0, 300) : 'Escenario sin título',
        expectedResult: typeof s.expectedResult === 'string' ? s.expectedResult.slice(0, 2000) : undefined,
        steps: Array.isArray(s.steps)
          ? s.steps
            .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object')
            .slice(0, 50)
            .map(step => ({
              action: typeof step.action === 'string' ? step.action.slice(0, 1000) : '',
              data: typeof step.data === 'string' ? step.data.slice(0, 1000) : undefined,
              expected: typeof step.expected === 'string' ? step.expected.slice(0, 1000) : undefined,
            }))
            .filter(step => step.action.length > 0)
          : [],
      }))
      .filter(s => hasPlaywrightAssertion(s.steps));
  } catch { return []; }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

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
  constructor(private readonly prisma: PrismaService, private readonly ai: AiRouter) {}

  // Sugiere escenarios con IA a partir de un requisito. Devuelve propuestas
  // que el cliente revisa y guarda manualmente; no persiste nada automático.
  async suggest(projectId: string, requirementId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const requirement = await this.prisma.requirement.findFirst({
      where: { id: requirementId, projectId },
      select: { title: true, description: true, acceptanceCriteria: true, externalKey: true },
    });
    if (!requirement) throw new NotFoundException('Requisito no encontrado.');

    const acceptance = Array.isArray(requirement.acceptanceCriteria)
      ? requirement.acceptanceCriteria.filter((c): c is string => typeof c === 'string').join('\n- ')
      : '';
    const prompt = [
      'Genera entre 2 y 4 propuestas de escenarios para revisar antes de guardar, a partir del siguiente requisito.',
      requirement.externalKey ? `Clave: ${requirement.externalKey}` : '',
      `Título: ${requirement.title}`,
      requirement.description ? `Descripción: ${requirement.description}` : '',
      acceptance ? `Criterios de aceptación:\n- ${acceptance}` : '',
      '',
      'Devuelve SOLO JSON válido con esta estructura, nada más:',
      '{"scenarios":[{"title":"Consultar resumen","expectedResult":"Se muestra Resumen","steps":[{"action":"navigate: /resumen"},{"action":"expect-text: Resumen"}]}]}',
      '',
      'Vocabulario de acciones permitido (prefijos reconocidos por el worker):',
      '- navigate: <url relativa o absoluta>',
      '- click: <selector css>',
      '- fill: <selector css>   (con "data" en el mismo paso para el valor)',
      '- press: <tecla>',
      '- expect-text: <texto visible>',
      '- expect-url: <ruta exacta>',
    ASSERTION_INSTRUCTION,
    ].filter(Boolean).join('\n');

    const response = await this.ai.dispatch({
      operation: 'scenario-generation',
      organizationId: workspace.organizationId ?? null,
      projectId,
      runKey: null,
      prompt,
      systemPrompt: 'Eres un ingeniero de QA. Responde solo JSON válido con los escenarios propuestos.',
      maxOutputTokens: 2048,
    });

    const scenarios = parseSuggestions(response.text);
    return {
      usedFallback: response.usedFallback ?? false,
      model: response.model,
      scenarios,
    };
  }

  async list(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const scenarios = await this.prisma.testScenario.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { title: 'asc' },
      select: {
        id: true, title: true, requirementId: true, expectedResult: true, steps: true, tags: true, automation: true,
        requirement: { select: { title: true, externalKey: true } },
        _count: { select: { results: true } },
      },
    });
    return scenarios.map(({ automation, ...scenario }) => {
      const prepared = isManualScenario(scenario) ? null : currentAutomation({ ...scenario, automation });
      return {
        ...scenario,
        playwright: prepared ? { automationId: prepared.id, filename: suggestedFilename(scenario) } : null,
      };
    });
  }

  async get(projectId: string, scenarioId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const scenario = await this.prisma.testScenario.findFirst({
      where: { id: scenarioId, projectId, archivedAt: null },
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
      // tags está en el schema pero el cliente Prisma puede no haberse
      // regenerado en este entorno; forzamos el cast para que compile y la
      // columna se escriba igual.
      data: {
        projectId,
        title,
        requirementId: dto.requirementId ?? null,
        expectedResult: dto.expectedResult?.trim() || null,
        tags: normalizeTags(dto.tags),
        steps: normalizeSteps(dto.steps),
      } as Prisma.TestScenarioUncheckedCreateInput,
      select: { id: true, title: true, requirementId: true, expectedResult: true, tags: true } as const,
    });
  }

  async update(projectId: string, scenarioId: string, dto: UpdateScenarioDto, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const existing = await this.prisma.testScenario.findFirst({ where: { id: scenarioId, projectId, archivedAt: null }, select: { id: true } });
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
    if (dto.tags !== undefined) {
      data.tags = { set: normalizeTags(dto.tags) };
    }
    try {
      return await this.prisma.testScenario.update({
        where: { id: scenarioId, projectId, archivedAt: null },
        data,
        select: { id: true, title: true, requirementId: true, expectedResult: true, tags: true, steps: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Escenario no encontrado.');
      }
      throw error;
    }
  }

  async remove(projectId: string, scenarioId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const archived = await this.prisma.testScenario.updateMany({
      where: { id: scenarioId, projectId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (!archived.count) throw new NotFoundException('Escenario no encontrado.');
  }

  async archiveSelected(projectId: string, scenarioIds: string[], workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const archived = await this.prisma.testScenario.updateMany({
      where: { projectId, id: { in: scenarioIds }, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return { archived: archived.count };
  }

  async deleteSelected(projectId: string, scenarioIds: string[], workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    return this.prisma.$transaction(async tx => {
      // Impide que una ejecución nueva se vincule a los escenarios mientras se eliminan.
      const scenarios = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM "TestScenario"
        WHERE "projectId" = ${projectId} AND id IN (${Prisma.join(scenarioIds)}) AND "archivedAt" IS NULL
        ORDER BY id FOR UPDATE
      `);
      if (!scenarios.length) return { deleted: 0 };

      const scenarioId = { in: scenarios.map(scenario => scenario.id) };
      const legacyRuns = { scenarioId: null, results: { some: { scenarioId } } };
      const active = await tx.testRun.findFirst({
        where: { projectId, status: { in: [...ACTIVE_RUN_STATUSES] }, OR: [{ scenarioId }, legacyRuns] },
        select: { id: true },
      });
      if (active) {
        throw new ConflictException('Detén las ejecuciones en cola o en curso de los escenarios seleccionados antes de eliminarlos.');
      }

      const legacy = await tx.testRun.findMany({ where: { projectId, ...legacyRuns }, select: { id: true } });
      await tx.testRun.deleteMany({ where: { projectId, scenarioId } });
      await tx.testResult.deleteMany({ where: { scenarioId, run: { projectId } } });
      if (legacy.length) {
        await tx.testRun.deleteMany({
          where: { projectId, id: { in: legacy.map(run => run.id) }, results: { none: {} } },
        });
      }
      const deleted = await tx.testScenario.deleteMany({ where: { projectId, id: scenarioId } });
      return { deleted: deleted.count };
    });
  }

  async generatePlaywright(projectId: string, scenarioId: string, workspace: Workspace) {
    const scenario = await this.get(projectId, scenarioId, workspace);
    if (isManualScenario(scenario)) throw new BadRequestException(MANUAL_SCENARIO_MESSAGE);
    return renderPlaywright(scenario, currentAutomation(scenario));
  }

  async preparePlaywright(projectId: string, scenarioId: string, workspace: Workspace) {
    const scenario = await this.get(projectId, scenarioId, workspace);
    if (isManualScenario(scenario)) throw new BadRequestException(MANUAL_SCENARIO_MESSAGE);

    const existing = currentAutomation(scenario);
    if (existing) return renderPlaywright(scenario, existing);

    const steps = await prepareWithAgent(scenario, this.ai, { projectId, organizationId: workspace.organizationId });
    if (!steps) {
      return renderPlaywright(scenario, null, 'El agente no pudo completar la automatización. Revisa el código base.');
    }

    const prepared: PreparedAutomation = {
      id: randomUUID(),
      signature: automationSignature(scenario),
      title: scenario.title,
      steps,
    };
    const saved = await this.prisma.testScenario.updateMany({
      where: {
        id: scenarioId, projectId, archivedAt: null, title: scenario.title, expectedResult: scenario.expectedResult,
        steps: { equals: scenario.steps ?? Prisma.JsonNull }, tags: { equals: scenario.tags },
        automation: { equals: scenario.automation ?? Prisma.DbNull },
      },
      data: { automation: prepared as unknown as Prisma.InputJsonValue },
    });
    if (saved.count) return renderPlaywright(scenario, prepared);

    const latest = await this.get(projectId, scenarioId, workspace);
    const other = currentAutomation(latest);
    if (!isManualScenario(latest) && other?.signature === prepared.signature) return renderPlaywright(latest, other);
    throw new ConflictException('El escenario cambió durante la generación. Actualiza la lista y vuelve a intentarlo.');
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

  // Exporta un conjunto de escenarios como set de pruebas en PDF o XLSX. Si
  // no se pasan ids, exporta todos los escenarios activos del proyecto. Se
  // limita a 500 escenarios por request para evitar generar documentos
  // enormes que bloqueen el proceso.
  async exportTestSet(
    projectId: string, scenarioIds: string[] | null, format: 'pdf' | 'xlsx', workspace: Workspace,
  ): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
    await this.ensureProject(projectId, workspace);
    if (scenarioIds && scenarioIds.length > 500) {
      throw new BadRequestException('No puedes exportar más de 500 escenarios a la vez.');
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    const scenarios = await this.prisma.testScenario.findMany({
      where: {
        projectId,
        archivedAt: null,
        ...(scenarioIds && scenarioIds.length ? { id: { in: scenarioIds } } : {}),
      },
      orderBy: { title: 'asc' },
      select: {
        id: true, title: true, tags: true, expectedResult: true, steps: true,
        requirement: { select: { externalKey: true, title: true } },
      },
    });
    if (!scenarios.length) {
      throw new NotFoundException('No hay escenarios para exportar con el filtro dado.');
    }
    const items: ExportScenario[] = scenarios.map(s => ({
      id: s.id,
      title: s.title,
      tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
      expectedResult: s.expectedResult,
      requirement: s.requirement,
      steps: readGeneratorSteps(s.steps).map(step => ({
        ordinal: step.ordinal,
        action: step.action,
        data: step.data ?? null,
        expected: step.expected ?? null,
      })),
    }));
    const projectName = project?.name ?? 'Proyecto AutoQA';
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'pdf') {
      const bytes = await buildTestSetPdf(projectName, items);
      return { bytes, filename: `set-pruebas-${stamp}.pdf`, contentType: 'application/pdf' };
    }
    const bytes = await buildTestSetXlsx(projectName, items);
    return { bytes, filename: `set-pruebas-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  // Indicadores de duplicación de pasos: agrupa pasos iguales o muy
  // parecidos (umbral 0.85 de Jaccard sobre tokens normalizados) entre
  // escenarios activos. La pestaña Calidad y el formulario de escenarios
  // usan este resultado para evitar que el usuario registre dos veces el
  // mismo paso. Se limita a los primeros 40 grupos para que la respuesta
  // quepa en el payload sin paginar.
  async insights(projectId: string, workspace: Workspace) {
    await this.ensureProject(projectId, workspace);
    const scenarios = await this.prisma.testScenario.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, steps: true },
    });
    const occurrences: StepOccurrence[] = [];
    let totalSteps = 0;
    for (const scenario of scenarios) {
      const steps = readGeneratorSteps(scenario.steps);
      for (const step of steps) {
        totalSteps++;
        occurrences.push({ scenarioId: scenario.id, scenarioTitle: scenario.title, ordinal: step.ordinal, text: step.action });
      }
    }
    const groups = groupSimilarSteps(occurrences, 0.85).slice(0, 40);
    const duplicatedSteps = groups.reduce((sum, group) => sum + group.occurrences.length, 0);
    return {
      scenarios: scenarios.length,
      steps: totalSteps,
      duplicateGroups: groups.length,
      duplicatedSteps,
      groups,
    };
  }

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }

  private async ensureRequirementInProject(projectId: string, requirementId: string) {
    const requirement = await this.prisma.requirement.findFirst({ where: { id: requirementId, projectId }, select: { id: true } });
    if (!requirement) throw new BadRequestException('El requisito no pertenece a este proyecto.');
  }
}

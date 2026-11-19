import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AiRouter } from '../ai/ai-router';
import { PrismaService } from '../prisma.service';
import { projectScope, type Workspace } from '../commerce/workspace.guard';
import { CreateScenarioDto, ScenarioStepDto, UpdateScenarioDto } from './dto/scenario.dto';
import { isManualScenario, MANUAL_SCENARIO_MESSAGE } from './scenario-tags';
import { automationSignature, currentAutomation, prepareWithAgent, type PreparedAutomation } from './automation-agent';
import { ASSERTION_INSTRUCTION } from '../automation/agents/agent-types';
import { generateSpec, hasPlaywrightAssertion, readGeneratorSteps, suggestedFilename } from './playwright-generator';

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
    return this.prisma.testScenario.findMany({
      where: { projectId },
      orderBy: { title: 'asc' },
      select: {
        id: true, title: true, requirementId: true, expectedResult: true, steps: true, tags: true,
        requirement: { select: { title: true, externalKey: true } },
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
    if (dto.tags !== undefined) {
      data.tags = { set: normalizeTags(dto.tags) };
    }
    return this.prisma.testScenario.update({
      where: { id: scenarioId },
      data,
      select: { id: true, title: true, requirementId: true, expectedResult: true, tags: true, steps: true },
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
        id: scenarioId, projectId, title: scenario.title, expectedResult: scenario.expectedResult,
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

  private async ensureProject(projectId: string, workspace: Workspace) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectScope(workspace) }, select: { id: true } });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
  }

  private async ensureRequirementInProject(projectId: string, requirementId: string) {
    const requirement = await this.prisma.requirement.findFirst({ where: { id: requirementId, projectId }, select: { id: true } });
    if (!requirement) throw new BadRequestException('El requisito no pertenece a este proyecto.');
  }
}

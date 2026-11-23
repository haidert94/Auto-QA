import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { IsUUID, isUUID } from 'class-validator';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateScenarioDto, ScenarioSelectionDto, UpdateScenarioDto } from './dto/scenario.dto';
import { ScenariosService } from './scenarios.service';
import { QualityExecutionService } from './quality-execution.service';

type HttpResponse = { setHeader(name: string, value: string): unknown };

class SuggestScenariosDto {
  @IsUUID() requirementId!: string;
}

@Controller('projects/:projectId/scenarios')
@UseGuards(WorkspaceGuard)
export class ScenariosController {
  constructor(private readonly service: ScenariosService, private readonly qualityExecution: QualityExecutionService) {}

  @Get()
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.list(projectId, workspace);
  }

  // Catálogo de requisitos del proyecto para el dropdown de autoría.
  @Get('requirements')
  requirements(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.listRequirements(projectId, workspace);
  }

  @Get('playwright-steps')
  sharedPlaywrightSteps(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.sharedPlaywrightSteps(projectId, workspace);
  }

  @Get('insights')
  insights(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.insights(projectId, workspace);
  }

  // Set de pruebas en PDF o XLSX. ids opcional separado por coma: si no
  // viene, exporta TODOS los escenarios activos del proyecto.
  @Get('export')
  async export(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('format') format: string | undefined,
    @Query('ids') ids: string | undefined,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const normalized = (format ?? '').toLowerCase();
    if (normalized !== 'pdf' && normalized !== 'xlsx') {
      throw new BadRequestException('Formato inválido. Usa format=pdf o format=xlsx.');
    }
    const scenarioIds = typeof ids === 'string' && ids.length
      ? ids.split(',').filter(Boolean)
      : null;
    if (scenarioIds && (!scenarioIds.length || scenarioIds.some(id => !isUUID(id)))) {
      throw new BadRequestException('Los identificadores de escenario no son válidos.');
    }
    const { bytes, filename, contentType } = await this.service.exportTestSet(projectId, scenarioIds, normalized, workspace);
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', String(bytes.byteLength));
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(bytes);
  }

  @Get('quality')
  @RequiresPlanCapability('BROWSER_TESTS')
  listQuality(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.listQuality(projectId, workspace);
  }

  @Post('quality/:kind/:id/executions/:attemptId')
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('BROWSER_TESTS')
  queueQuality(
    @Param('projectId', ParseUUIDPipe) projectId: string, @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string, @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.qualityExecution.queue(projectId, id, kind, attemptId, workspace);
  }

  @Get('quality/:kind/:id/executions/:attemptId')
  @RequiresPlanCapability('BROWSER_TESTS')
  qualityStatus(
    @Param('projectId', ParseUUIDPipe) projectId: string, @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string, @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    return this.qualityExecution.status(projectId, id, kind, attemptId);
  }

  @Get('quality/:kind/:id/automation')
  @RequiresPlanCapability('BROWSER_TESTS')
  getQualityAutomation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.qualityAutomation(projectId, kind, id, workspace, false);
  }

  @Post('quality/:kind/:id/automation')
  @HttpCode(200)
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('BROWSER_TESTS')
  async prepareQualityAutomation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.qualityAutomation(projectId, kind, id, workspace, true);
  }

  @Get(':id')
  get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.get(projectId, id, workspace);
  }

  @Post()
  @RequiresRole('EDITOR')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateScenarioDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, dto, workspace);
  }

  @Post('suggest')
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('AI_SCENARIO_GENERATION')
  suggest(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: SuggestScenariosDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.suggest(projectId, dto.requirementId, workspace);
  }

  @Get(':id/playwright')
  playwright(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.generatePlaywright(projectId, id, workspace);
  }

  @Post(':id/playwright')
  @RequiresRole('EDITOR')
  preparePlaywright(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.preparePlaywright(projectId, id, workspace);
  }

  @Patch(':id')
  @RequiresRole('EDITOR')
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScenarioDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.update(projectId, id, dto, workspace);
  }

  @Post('archive')
  @HttpCode(200)
  @RequiresRole('EDITOR')
  archiveSelected(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ScenarioSelectionDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.archiveSelected(projectId, dto.scenarioIds, workspace);
  }

  @Post('delete-selected')
  @HttpCode(200)
  @RequiresRole('EDITOR')
  deleteSelected(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ScenarioSelectionDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.deleteSelected(projectId, dto.scenarioIds, workspace);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiresRole('EDITOR')
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.remove(projectId, id, workspace);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateScenarioDto, UpdateScenarioDto } from './dto/scenario.dto';
import { ScenariosService } from './scenarios.service';

class SuggestScenariosDto {
  @IsUUID() requirementId!: string;
}

@Controller('projects/:projectId/scenarios')
@UseGuards(WorkspaceGuard)
export class ScenariosController {
  constructor(private readonly service: ScenariosService) {}

  @Get()
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.list(projectId, workspace);
  }

  // Catálogo de requisitos del proyecto para el dropdown de autoría.
  @Get('requirements')
  requirements(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.listRequirements(projectId, workspace);
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

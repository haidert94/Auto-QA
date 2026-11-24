import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { AutomationValidationService, MAX_VALIDATION_CASES } from './automation-validation.service';

class StartValidationDto {
  @IsUUID() environmentId!: string;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(MAX_VALIDATION_CASES) @ArrayUnique()
  @IsUUID(undefined, { each: true }) scenarioIds!: string[];
}

@Controller()
export class AutomationValidationController {
  constructor(private readonly service: AutomationValidationService) {}

  @Get('projects/:projectId/automation-validations')
  @UseGuards(WorkspaceGuard)
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.list(projectId, workspace);
  }

  @Post('projects/:projectId/automation-validations')
  @UseGuards(WorkspaceGuard)
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('BROWSER_TESTS')
  start(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace, @Body() dto: StartValidationDto) {
    return this.service.start(projectId, workspace, dto);
  }

  @Post('automation-validations/:validationId/advance')
  async advance(
    @Param('validationId', ParseUUIDPipe) validationId: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-autoqa-github-run') runId?: string,
  ) {
    const { id, status, version, counts } = await this.service.advance(validationId, authorization, runId);
    return { id, status, version, counts };
  }
}

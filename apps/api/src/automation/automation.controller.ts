import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { AutomationService } from './automation.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { SelectTestsDto } from './dto/select-tests.dto';

@Controller('projects/:projectId/automation')
@UseGuards(WorkspaceGuard)
export class AutomationController {
  constructor(private readonly service: AutomationService) {}

  @Get()
  @RequiresPlanCapability('AI_DOCUMENT_ANALYSIS')
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.list(projectId, workspace);
  }

  @Get(':id')
  @RequiresPlanCapability('AI_DOCUMENT_ANALYSIS')
  get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.get(projectId, id, workspace);
  }

  @Post()
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('AI_DOCUMENT_ANALYSIS')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateAutomationDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, dto, workspace);
  }

  @Get('types/available')
  @RequiresPlanCapability('AI_DOCUMENT_ANALYSIS')
  availableTypes(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.availableTypes(projectId, workspace);
  }

  @Get('types/pending')
  @RequiresPlanCapability('AI_DOCUMENT_ANALYSIS')
  pendingDocumentTypes(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.pendingDocumentTypes(projectId, workspace);
  }

  @Post(':id/select')
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('AI_DOCUMENT_ANALYSIS')
  select(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelectTestsDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.select(projectId, id, dto, workspace);
  }
}

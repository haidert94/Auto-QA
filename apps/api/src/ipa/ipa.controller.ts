import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { IpaService } from './ipa.service';

@Controller('projects/:projectId/ipa')
@UseGuards(WorkspaceGuard)
export class IpaController {
  constructor(private readonly service: IpaService) {}

  @Get()
  current(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.current(projectId, workspace);
  }

  @Get('history')
  history(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.history(projectId, workspace);
  }
}

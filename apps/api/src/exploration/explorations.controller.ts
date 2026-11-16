import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateExplorationDto } from './dto/create-exploration.dto';
import { ExplorationsService } from './explorations.service';

@Controller('projects/:projectId/explorations')
@UseGuards(WorkspaceGuard)
export class ExplorationsController {
  constructor(private readonly service: ExplorationsService) {}

  @Get()
  @RequiresPlanCapability('BROWSER_TESTS')
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.list(projectId, workspace);
  }

  @Get(':id')
  @RequiresPlanCapability('BROWSER_TESTS')
  get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.get(projectId, id, workspace);
  }

  @Post()
  @RequiresPlanCapability('BROWSER_TESTS')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateExplorationDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, dto, workspace);
  }
}

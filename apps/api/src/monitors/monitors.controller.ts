import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateMonitorDto, UpdateMonitorDto } from './dto/create-monitor.dto';
import { MonitorsService } from './monitors.service';

@Controller('projects/:projectId/monitors')
@UseGuards(WorkspaceGuard)
export class MonitorsController {
  constructor(private readonly service: MonitorsService) {}

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
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('BROWSER_TESTS')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateMonitorDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, dto, workspace);
  }

  @Patch(':id')
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('BROWSER_TESTS')
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMonitorDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.update(projectId, id, dto, workspace);
  }

  @Delete(':id')
  @RequiresRole('ADMIN')
  @RequiresPlanCapability('BROWSER_TESTS')
  @HttpCode(200)
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.remove(projectId, id, workspace);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(WorkspaceGuard)
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list(@CurrentWorkspace() workspace: Workspace) { return this.service.list(workspace); }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.get(id, workspace);
  }

  @Post() @RequiresRole('ADMIN')
  create(@Body() dto: CreateProjectDto, @CurrentWorkspace() workspace: Workspace) {
    return this.service.create(dto, workspace);
  }

  @Put(':id') @RequiresRole('EDITOR')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto, @CurrentWorkspace() workspace: Workspace) {
    return this.service.update(id, dto, workspace);
  }

  @Delete(':id') @HttpCode(200) @RequiresRole('ADMIN')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.remove(id, workspace);
  }
}

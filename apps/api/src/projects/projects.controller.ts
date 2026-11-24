import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import { SetStorageStateDto } from './dto/set-storage-state.dto';
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

  // storageState importado por el QA: cookies+localStorage exportados de su
  // propio navegador tras loguearse. El worker lo inyecta en test.use() para
  // que la suite no tenga que loguearse de nuevo. Cifrado en reposo; nunca
  // vuelve al cliente como blob — solo metadatos.
  @Put(':id/environments/:environmentId/storage-state') @RequiresRole('EDITOR')
  setStorageState(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('environmentId', ParseUUIDPipe) environmentId: string,
    @Body() dto: SetStorageStateDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.setStorageState(id, environmentId, dto, workspace);
  }

  @Delete(':id/environments/:environmentId/storage-state') @HttpCode(200) @RequiresRole('EDITOR')
  clearStorageState(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('environmentId', ParseUUIDPipe) environmentId: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.clearStorageState(id, environmentId, workspace);
  }
}

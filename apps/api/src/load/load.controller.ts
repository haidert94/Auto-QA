import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateLoadTestDto } from './dto/create-load-test.dto';
import { LoadService } from './load.service';

type HttpResponse = { setHeader(name: string, value: string): unknown };

@Controller('projects/:projectId/load-tests')
@UseGuards(WorkspaceGuard)
export class LoadController {
  constructor(private readonly service: LoadService) {}

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
  @RequiresRole('ADMIN')
  @RequiresPlanCapability('BROWSER_TESTS')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateLoadTestDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, dto, workspace);
  }

  @Get(':id/summary')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async summary(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const bytes = await this.service.summary(projectId, id, workspace);
    response.setHeader('Content-Length', String(bytes.byteLength));
    response.setHeader('Content-Disposition', `attachment; filename="k6-summary-${id}.json"`);
    return new StreamableFile(bytes);
  }
}

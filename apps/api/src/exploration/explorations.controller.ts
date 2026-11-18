import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';

type HttpResponse = { setHeader(name: string, value: string): unknown };
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
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('BROWSER_TESTS')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateExplorationDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, dto, workspace);
  }

  @Get(':id/diff')
  @RequiresPlanCapability('BROWSER_TESTS')
  diff(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('previous') previousId: string | undefined,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const previous = previousId && uuid.test(previousId) ? previousId : null;
    return this.service.diff(projectId, id, previous, workspace);
  }

  @Get(':id/pages/:pageId/screenshot')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async screenshot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const bytes = await this.service.screenshot(projectId, id, pageId, workspace);
    response.setHeader('Content-Length', String(bytes.byteLength));
    return new StreamableFile(bytes);
  }
}

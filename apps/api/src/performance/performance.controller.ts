import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateAuditDto } from './dto/create-audit.dto';
import { PerformanceService } from './performance.service';

type HttpResponse = { setHeader(name: string, value: string): unknown };

@Controller('projects/:projectId/audits')
@UseGuards(WorkspaceGuard)
export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}

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
    @Body() dto: CreateAuditDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, dto, workspace);
  }

  @Get(':id/report')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async report(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const bytes = await this.service.report(projectId, id, workspace);
    response.setHeader('Content-Length', String(bytes.byteLength));
    response.setHeader('Content-Disposition', `attachment; filename="lighthouse-${id}.json"`);
    return new StreamableFile(bytes);
  }
}

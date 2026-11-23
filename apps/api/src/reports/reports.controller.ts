import { Controller, Get, Header, Param, ParseUUIDPipe, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { ReportsService } from './reports.service';

type HttpResponse = { setHeader(name: string, value: string): unknown };

@Controller('projects/:projectId/report')
@UseGuards(WorkspaceGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('quality')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Cache-Control', 'no-store')
  quality(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.quality(projectId, workspace);
  }

  @Get('quality/availability/:id')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Cache-Control', 'no-store')
  availability(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.availabilityHistory(projectId, id, workspace);
  }

  @Get('quality/ux/:id')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Cache-Control', 'no-store')
  ux(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace) {
    return this.service.uxDetails(projectId, id, workspace);
  }

  @Get('quality/ux/:id/screenshot')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async uxScreenshot(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: Workspace) {
    const bytes = await this.service.uxScreenshot(projectId, id, workspace);
    return new StreamableFile(bytes, { type: 'image/png', disposition: 'attachment; filename="captura-ux.png"' });
  }

  @Get('export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async export(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const report = await this.service.export(projectId, workspace);
    response.setHeader('Content-Disposition',
      `attachment; filename="autoqa-report-${projectId.slice(0, 8)}.json"`);
    return report;
  }
}

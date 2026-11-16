import { Controller, Get, Header, Param, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { ReportsService } from './reports.service';

type HttpResponse = { setHeader(name: string, value: string): unknown };

@Controller('projects/:projectId/report')
@UseGuards(WorkspaceGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

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

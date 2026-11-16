import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, RequiresPlanCapability, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateRunDto } from './dto/create-run.dto';
import { RunsService } from './runs.service';

type HttpResponse = { setHeader(name: string, value: string): unknown };

@Controller()
@UseGuards(WorkspaceGuard)
export class RunsController {
  constructor(private readonly service: RunsService) {}

  @Get('projects/:projectId/runs')
  @RequiresPlanCapability('BROWSER_TESTS')
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.list(projectId, workspace);
  }

  @Get('projects/:projectId/runs/:runId')
  @RequiresPlanCapability('BROWSER_TESTS')
  get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.get(projectId, runId, workspace);
  }

  @Get('projects/:projectId/scenarios/:scenarioId/runs')
  @RequiresPlanCapability('BROWSER_TESTS')
  listForScenario(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.listForScenario(projectId, scenarioId, workspace);
  }

  @Post('projects/:projectId/scenarios/:scenarioId/runs')
  @RequiresPlanCapability('BROWSER_TESTS')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Body() dto: CreateRunDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, scenarioId, dto, workspace);
  }

  @Get('projects/:projectId/runs/:runId/trace/:resultId')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Content-Type', 'application/zip')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async trace(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('resultId', ParseUUIDPipe) resultId: string,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const bytes = await this.service.trace(projectId, runId, resultId, workspace);
    response.setHeader('Content-Length', String(bytes.byteLength));
    response.setHeader('Content-Disposition', `attachment; filename="trace-${resultId}.zip"`);
    return new StreamableFile(bytes);
  }
}

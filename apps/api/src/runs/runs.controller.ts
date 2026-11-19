import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateRunDto } from './dto/create-run.dto';
import { RunsService } from './runs.service';

type HttpResponse = { setHeader(name: string, value: string): unknown };

@Controller()
@UseGuards(WorkspaceGuard)
export class RunsController {
  constructor(private readonly service: RunsService) {}

  @Get('projects/:projectId/runs')
  @RequiresPlanCapability('BROWSER_TESTS')
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('ids') ids: string | undefined,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    if (ids === undefined) return this.service.list(projectId, workspace);
    const runIds = typeof ids === 'string' ? ids.split(',') : [];
    if (!runIds.length || runIds.length > 100 || runIds.some(id => !isUUID(id))) {
      throw new BadRequestException('Especifica entre 1 y 100 identificadores válidos de ejecuciones.');
    }
    return this.service.list(projectId, workspace, runIds);
  }

  @Get('projects/:projectId/runs/activity')
  @RequiresPlanCapability('BROWSER_TESTS')
  activity(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.activity(projectId, workspace);
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
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('BROWSER_TESTS')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Body() dto: CreateRunDto,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.create(projectId, scenarioId, dto, workspace);
  }

  @Post('projects/:projectId/runs/:runId/explain')
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('AI_FAILURE_EXPLANATION')
  explain(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.explain(projectId, runId, workspace);
  }

  @Get('projects/:projectId/runs/:runId/diff')
  @RequiresPlanCapability('BROWSER_TESTS')
  diff(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('previous') previousId: string | undefined,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const previous = previousId && uuid.test(previousId) ? previousId : null;
    return this.service.diff(projectId, runId, previous, workspace);
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

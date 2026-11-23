import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { isUUID } from 'class-validator';
import { CurrentWorkspace, RequiresPlanCapability, RequiresRole, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { CreateRunDto } from './dto/create-run.dto';
import { RunsService } from './runs.service';

type UploadedFile = { originalname: string; mimetype: string; buffer: Buffer };

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
    @Query('view') view?: string,
  ) {
    if (ids === undefined) {
      if (view === 'overview') return this.service.reportOverview(projectId, workspace);
      return this.service.list(projectId, workspace, undefined, view === 'report');
    }
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

  @Post('projects/:projectId/runs/cancel')
  @HttpCode(200)
  @RequiresRole('EDITOR')
  cancel(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.cancelActive(projectId, workspace);
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

  // Ejecución manual: multipart con status + notas + N imágenes. La ruta
  // solo acepta escenarios con el tag @manual (lo valida el servicio).
  // Si el escenario ya tiene un run manual previo, lo actualiza.
  @Post('projects/:projectId/scenarios/:scenarioId/runs/manual')
  @RequiresRole('EDITOR')
  @RequiresPlanCapability('BROWSER_TESTS')
  @UseInterceptors(FilesInterceptor('screenshots', 8, { limits: { fileSize: 1_500_000, files: 8 } }))
  manualRun(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Body('status') status: string,
    @Body('notes') notes: string | undefined,
    @UploadedFiles() files: UploadedFile[] = [],
    @CurrentWorkspace() workspace: Workspace,
  ) {
    const normalized = (status ?? '').toUpperCase();
    if (!['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'].includes(normalized)) {
      throw new BadRequestException('Estado inválido.');
    }
    return this.service.upsertManualRun(projectId, scenarioId, workspace, {
      status: normalized as 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED',
      notes,
      screenshots: files.map(file => ({ filename: file.originalname, mimetype: file.mimetype, buffer: file.buffer })),
    });
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

  // Reporte consolidado estilo SerenityBDD: zip con index.html + páginas por
  // escenario + assets. El cliente pasa ids=run1,run2,... (hasta 200).
  @Get('projects/:projectId/runs/export-report')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Content-Type', 'application/zip')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportReport(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('ids') ids: string | undefined,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const runIds = typeof ids === 'string' ? ids.split(',').filter(Boolean) : [];
    if (!runIds.length || runIds.some(id => !isUUID(id))) {
      throw new BadRequestException('Especifica entre 1 y 200 identificadores válidos de ejecuciones.');
    }
    const { bytes, filename } = await this.service.exportReport(projectId, runIds, workspace);
    response.setHeader('Content-Length', String(bytes.byteLength));
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(bytes);
  }

  // Manifiesto JSON de evidencias para un resultado. La UI lo pide una vez
  // y después pide cada screenshot / video por su key opaca.
  @Get('projects/:projectId/runs/:runId/results/:resultId/evidence')
  @Header('Cache-Control', 'no-store')
  @RequiresPlanCapability('BROWSER_TESTS')
  evidence(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('resultId', ParseUUIDPipe) resultId: string,
    @CurrentWorkspace() workspace: Workspace,
  ) {
    return this.service.evidenceManifest(projectId, runId, resultId, workspace);
  }

  // Devuelve los bytes de un screenshot (PNG). La key debe estar listada en
  // el manifiesto del result, si no se rechaza con 404.
  @Get('projects/:projectId/runs/:runId/results/:resultId/screenshot/:key')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async screenshot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('resultId', ParseUUIDPipe) resultId: string,
    @Param('key') key: string,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    if (!/^[0-9a-f]{32}$/.test(key)) throw new BadRequestException('Clave inválida.');
    const { bytes } = await this.service.evidenceAsset(projectId, runId, resultId, 'screenshot', key, workspace);
    response.setHeader('Content-Length', String(bytes.byteLength));
    return new StreamableFile(bytes);
  }

  // Devuelve los bytes del video (WebM). Solo se graba en fallos
  // (retain-on-failure); si no hay video el manifiesto devuelve video: null.
  @Get('projects/:projectId/runs/:runId/results/:resultId/video/:key')
  @RequiresPlanCapability('BROWSER_TESTS')
  @Header('Content-Type', 'video/webm')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async video(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('resultId', ParseUUIDPipe) resultId: string,
    @Param('key') key: string,
    @CurrentWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    if (!/^[0-9a-f]{32}$/.test(key)) throw new BadRequestException('Clave inválida.');
    const { bytes } = await this.service.evidenceAsset(projectId, runId, resultId, 'video', key, workspace);
    response.setHeader('Content-Length', String(bytes.byteLength));
    return new StreamableFile(bytes);
  }
}

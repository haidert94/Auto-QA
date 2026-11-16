import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { IcspService } from './icsp.service';

@Controller('projects/:projectId/icsp')
@UseGuards(WorkspaceGuard)
export class IcspController {
  constructor(private readonly service: IcspService) {}

  @Get()
  current(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.current(projectId, workspace);
  }

  @Get('history')
  history(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.history(projectId, workspace);
  }

  // Graba un QualityAssessment(type=TEST_QUALITY) con el ICSP actual.
  // Es el mecanismo para construir el histórico; un hook futuro (p. ej. tras
  // cada TestRun) podría llamar al servicio en vez de este endpoint.
  @Post('snapshot')
  @HttpCode(201)
  snapshot(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentWorkspace() workspace: Workspace) {
    return this.service.snapshot(projectId, workspace);
  }
}

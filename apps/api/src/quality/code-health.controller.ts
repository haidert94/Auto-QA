import { Controller, Get, UseGuards } from '@nestjs/common';
import { WorkspaceGuard } from '../commerce/workspace.guard';
import { CodeHealthService } from './code-health.service';

// Endpoint global (no por proyecto) porque la "salud del código" aplica al
// repositorio completo del producto, no a cada proyecto que se registra
// dentro del SaaS. Lo protegemos con WorkspaceGuard para exigir sesión
// autorizada igual que el resto del API.
@Controller('quality')
@UseGuards(WorkspaceGuard)
export class CodeHealthController {
  constructor(private readonly service: CodeHealthService) {}

  @Get('code-health')
  codeHealth() {
    return this.service.read();
  }
}

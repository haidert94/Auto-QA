import { Controller, Get, Header, Headers, NotFoundException } from '@nestjs/common';
import { AccountService } from '../commerce/account';
import { canViewCodeHealth } from '../commerce/admin';
import { CodeHealthService } from './code-health.service';

@Controller('quality')
export class CodeHealthController {
  constructor(private readonly service: CodeHealthService, private readonly accounts: AccountService) {}

  @Get('code-health')
  @Header('Cache-Control', 'private, no-store')
  async codeHealth(@Headers('authorization') authorization?: string) {
    const { email } = await this.accounts.identity(authorization);
    if (!canViewCodeHealth(email)) throw new NotFoundException();
    return this.service.read();
  }
}

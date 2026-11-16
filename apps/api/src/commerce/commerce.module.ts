import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AccountService } from './account';
import { ACCOUNT_MAIL_TRANSPORT, AccountMail, SmtpAccountMailTransport } from './account-mail';
import { AdminService } from './admin';
import { CommerceController } from './commerce.controller';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { BillingService, SandboxPaymentProvider } from './payments';
import { WorkspaceGuard } from './workspace.guard';
import { UsageService } from './usage.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [CommerceController, MembersController],
  providers: [
    AccountMail, AccountService, AdminService, BillingService, SandboxPaymentProvider, WorkspaceGuard, UsageService,
    MembersService,
    { provide: ACCOUNT_MAIL_TRANSPORT, useClass: SmtpAccountMailTransport },
  ],
  exports: [AccountService, WorkspaceGuard, UsageService, MembersService],
})
export class CommerceModule {}

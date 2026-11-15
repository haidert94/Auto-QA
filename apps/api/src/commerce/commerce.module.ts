import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AccountService } from './account';
import { ACCOUNT_MAIL_TRANSPORT, AccountMail, SmtpAccountMailTransport } from './account-mail';
import { AdminService } from './admin';
import { CommerceController } from './commerce.controller';
import { BillingService, SandboxPaymentProvider } from './payments';
import { WorkspaceGuard } from './workspace.guard';
import { UsageService } from './usage.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [CommerceController],
  providers: [
    AccountMail, AccountService, AdminService, BillingService, SandboxPaymentProvider, WorkspaceGuard, UsageService,
    { provide: ACCOUNT_MAIL_TRANSPORT, useClass: SmtpAccountMailTransport },
  ],
  exports: [AccountService, WorkspaceGuard],
})
export class CommerceModule {}

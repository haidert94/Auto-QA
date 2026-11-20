import { Global, Module } from '@nestjs/common';
import { createScreenshotReader, SCREENSHOT_READER } from '../exploration/screenshot-storage';
import { PrismaModule } from '../prisma.module';
import { AccountService } from './account';
import { ACCOUNT_MAIL_TRANSPORT, AccountMail, SmtpAccountMailTransport } from './account-mail';
import { AdminService } from './admin';
import { CommerceController } from './commerce.controller';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { BillingService, SandboxPaymentProvider } from './payments';
import { SecretCipher } from './secret-cipher';
import { WorkspaceGuard } from './workspace.guard';
import { UsageService } from './usage.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [CommerceController, MembersController],
  providers: [
    AccountMail, AccountService, AdminService, BillingService, SandboxPaymentProvider, WorkspaceGuard, UsageService,
    MembersService, SecretCipher,
    { provide: ACCOUNT_MAIL_TRANSPORT, useClass: SmtpAccountMailTransport },
    { provide: SCREENSHOT_READER, useFactory: () => createScreenshotReader() },
  ],
  exports: [AccountService, WorkspaceGuard, UsageService, MembersService, SecretCipher, SCREENSHOT_READER],
})
export class CommerceModule {}

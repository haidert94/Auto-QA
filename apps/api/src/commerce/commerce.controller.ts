import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AccountService } from './account';
import { AdminService } from './admin';
import { BillingService, SandboxPaymentProvider, subscriptionStatus } from './payments';
import { publicPlan } from './plan-capabilities';
import { UsageService } from './usage.service';

class EmailDto {
  @IsEmail() @Length(3, 254) email!: string;
}
class LoginDto extends EmailDto {
  @IsString() @Length(12, 128) password!: string;
}
class RegisterDto extends LoginDto {
  @IsString() @Length(1, 100) @Matches(/^[^\u0000-\u001f]+$/) name!: string;
  @IsOptional() @IsString() @Length(1, 120) @Matches(/^[^\u0000-\u001f]+$/) company?: string;
  @Matches(/^[a-z][a-z0-9-]{1,29}$/) plan!: string;
  @IsString() @Length(1, 30) consentVersion!: string;
}
class TokenDto {
  @Matches(/^[a-f0-9]{64}$/) token!: string;
}
class ResetDto extends TokenDto {
  @IsString() @Length(12, 128) password!: string;
}
class CheckoutDto {
  @Matches(/^[a-z][a-z0-9-]{1,29}$/) plan!: string;
}
class SimulateDto {
  @IsIn(['approved', 'failed']) outcome!: 'approved' | 'failed';
}
class PaymentEventDto {
  @IsString() @Length(2, 4000) payload!: string;
  @Matches(/^[a-f0-9]{64}$/) signature!: string;
}
class AdminActivateDto {
  @IsEmail() @Length(3, 254) email!: string;
  @Matches(/^[a-z][a-z0-9-]{1,29}$/) plan!: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) days?: number;
}

@Controller('commerce')
export class CommerceController {
  constructor(private readonly accounts: AccountService, private readonly billing: BillingService,
    private readonly sandbox: SandboxPaymentProvider, private readonly usage: UsageService,
    private readonly admin: AdminService) {}

  @Get('plans') plans() { return this.billing.plans(); }

  @Post('register') register(@Body() input: RegisterDto, @Ip() ip: string) {
    this.accounts.limit('register-ip', ip, 12);
    return this.accounts.register(input);
  }

  @Post('login') @HttpCode(200)
  login(@Body() input: LoginDto, @Ip() ip: string) {
    this.accounts.limit('login-ip', ip, 40);
    return this.accounts.login(input.email, input.password);
  }

  @Post('verify') @HttpCode(200)
  verify(@Body() input: TokenDto, @Ip() ip: string) {
    this.accounts.limit('verify-ip', ip, 40);
    return this.accounts.verify(input.token);
  }

  @Post('resend') @HttpCode(200)
  resend(@Body() input: EmailDto, @Ip() ip: string) {
    this.accounts.limit('resend-ip', ip, 20);
    return this.accounts.request(input.email, 'VERIFY_EMAIL');
  }

  @Post('forgot') @HttpCode(200)
  forgot(@Body() input: EmailDto, @Ip() ip: string) {
    this.accounts.limit('forgot-ip', ip, 20);
    return this.accounts.request(input.email, 'RESET_PASSWORD');
  }

  @Post('reset') @HttpCode(200)
  reset(@Body() input: ResetDto, @Ip() ip: string) {
    this.accounts.limit('reset-ip', ip, 20);
    return this.accounts.reset(input.token, input.password);
  }

  @Post('logout') @HttpCode(200)
  logout(@Headers('authorization') auth?: string) { return this.accounts.logout(auth); }

  @Get('me')
  async me(@Headers('authorization') auth?: string) {
    const { name, email, organization } = await this.accounts.identity(auth);
    const subscription = organization.subscription;
    return {
      name, email, organization: { id: organization.id, name: organization.name },
      subscription: {
        status: subscriptionStatus(subscription), plan: subscription ? publicPlan(subscription.plan) : undefined,
        checkoutPrepared: !!subscription?.reference && !!subscription?.quotedPriceCop,
        quotedPriceCop: subscription?.quotedPriceCop,
        periodEndsAt: subscription?.periodEndsAt,
      },
      sandbox: this.sandbox.enabled(),
    };
  }

  @Get('usage')
  async getUsage(@Headers('authorization') auth?: string) {
    const { organization } = await this.accounts.identity(auth);
    return this.usage.summary(organization.id);
  }

  @Post('checkout') @HttpCode(200)
  async checkout(@Headers('authorization') auth: string | undefined, @Body() body: CheckoutDto) {
    const { organization, role } = await this.accounts.identity(auth);
    if (role !== 'OWNER') throw new ForbiddenException('Solo el OWNER puede contratar o cambiar la suscripción.');
    this.accounts.limit('checkout', organization.id, 15);
    await this.billing.checkout(organization.id, body.plan);
    return { message: 'Contratación de prueba preparada.' };
  }

  @Post('simulate') @HttpCode(200)
  async simulate(@Headers('authorization') auth: string | undefined, @Body() body: SimulateDto) {
    const { organization, role } = await this.accounts.identity(auth);
    if (role !== 'OWNER') throw new ForbiddenException('Solo el OWNER puede simular pagos.');
    this.accounts.limit('simulate', organization.id, 15);
    return this.billing.simulate(organization.id, body.outcome);
  }

  @Post('cancel') @HttpCode(200)
  async cancel(@Headers('authorization') auth: string | undefined) {
    const { organization, role } = await this.accounts.identity(auth);
    if (role !== 'OWNER') throw new ForbiddenException('Solo el OWNER puede cancelar la suscripción.');
    return this.billing.cancel(organization.id);
  }

  @Post('events/sandbox') @HttpCode(200)
  event(@Body() body: PaymentEventDto, @Ip() ip: string) {
    this.accounts.limit('sandbox-event', ip, 100);
    return this.billing.accept(this.sandbox, body.payload, body.signature);
  }

  @Post('admin/activate') @HttpCode(200)
  activate(@Body() body: AdminActivateDto, @Headers('x-admin-token') token: string | undefined, @Ip() ip: string) {
    this.accounts.limit('admin-activate-ip', ip, 20);
    return this.admin.activate({ email: body.email, plan: body.plan, days: body.days ?? 30 }, token);
  }
}

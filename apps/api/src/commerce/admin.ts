import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';

const tokenPattern = /^[a-f0-9]{64}$/;

@Injectable()
export class AdminService {
  constructor(private readonly db: PrismaService) {}

  private requireToken(provided: string | undefined) {
    const expected = process.env.AUTOQA_ADMIN_TOKEN;
    if (!expected || !tokenPattern.test(expected)) {
      throw new ServiceUnavailableException('Activación manual sin configurar.');
    }
    if (!provided || !tokenPattern.test(provided) ||
      !timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))) {
      throw new ForbiddenException('Credencial de administración inválida.');
    }
  }

  async activate(input: { email: string; plan: string; days: number }, token: string | undefined) {
    this.requireToken(token);
    const user = await this.db.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: { membership: { include: { organization: { include: { subscription: true } } } } },
    });
    const organization = user?.membership?.organization;
    if (!user || !organization) throw new NotFoundException('Cuenta u organización no encontrada.');
    const plan = await this.db.plan.findFirst({ where: { code: input.plan, enabled: true } });
    if (!plan) throw new BadRequestException('Plan no disponible.');
    const periodEndsAt = new Date(Date.now() + input.days * 86400000);
    const subscription = await this.db.subscription.update({
      where: { organizationId: organization.id },
      data: {
        planCode: plan.code, status: 'ACTIVE', periodEndsAt,
        reference: null, quotedPriceCop: null,
      },
    });
    return {
      email: user.email, organizationId: organization.id, plan: plan.code,
      status: subscription.status, periodEndsAt: subscription.periodEndsAt,
    };
  }
}

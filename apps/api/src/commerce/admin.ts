import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { SCREENSHOT_READER, type ScreenshotReader } from '../exploration/screenshot-storage';
import { PrismaService } from '../prisma.service';

const tokenPattern = /^[a-f0-9]{64}$/;

export function canViewCodeHealth(verifiedEmail: string): boolean {
  const ownerEmail = process.env.AUTOQA_CODE_HEALTH_OWNER_EMAIL?.trim().toLowerCase();
  return !!ownerEmail && verifiedEmail.toLowerCase() === ownerEmail;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly db: PrismaService,
    @Inject(SCREENSHOT_READER) private readonly evidence: ScreenshotReader,
  ) {}

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

  // Limpia TestResult.evidenceKey que apuntan a archivos que ya no existen
  // en el storage de evidencias. Pasa por lotes para evitar cargar toda la
  // tabla a la vez. Devuelve conteos para que la UI muestre el impacto.
  async cleanupOrphanTraces(token: string | undefined) {
    this.requireToken(token);
    const batchSize = 500;
    let cursor: string | undefined;
    let scanned = 0;
    let cleared = 0;
    for (;;) {
      const batch = await this.db.testResult.findMany({
        where: { evidenceKey: { not: null } },
        select: { id: true, evidenceKey: true },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      cursor = batch[batch.length - 1].id;
      const missing: string[] = [];
      for (const row of batch) {
        scanned += 1;
        const bytes = await this.evidence.read(row.evidenceKey!).catch(() => null);
        if (!bytes || bytes.length === 0) missing.push(row.id);
      }
      if (missing.length) {
        const result = await this.db.testResult.updateMany({
          where: { id: { in: missing } },
          data: { evidenceKey: null },
        });
        cleared += result.count;
      }
      if (batch.length < batchSize) break;
    }
    return { scanned, cleared };
  }
}

import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AccountTokenKind, Prisma } from '@prisma/client';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { AccountMail } from './account-mail';
import { planInclude } from './plan-capabilities';

export const CONSENT_VERSION = 'local-1';
export const SESSION_SECONDS = 7 * 86400;
const tokenPattern = /^[a-f0-9]{64}$/;
export const newToken = () => randomBytes(32).toString('hex');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function key(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }, (err, value) =>
      err ? reject(err) : resolve(value));
  });
}

async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await key(password, salt)).toString('hex');
}

type Registration = { name: string; email: string; password: string; company?: string; plan: string; consentVersion: string };
type Transaction = Prisma.TransactionClient;

@Injectable()
export class AccountService {
  private readonly rate = new Map<string, { count: number; until: number }>();

  constructor(private readonly db: PrismaService, private readonly mail: AccountMail) {}

  limit(scope: string, subject: string, allowance: number) {
    const now = Date.now();
    if (this.rate.size >= 3000) {
      for (const [id, window] of this.rate) if (window.until <= now) this.rate.delete(id);
      if (this.rate.size >= 3000) throw new HttpException('Inténtalo en unos minutos.', 429);
    }
    const id = scope + ':' + digest(subject);
    const existing = this.rate.get(id);
    const window = existing && existing.until > now ? existing : { count: 0, until: now + 60000 };
    if (++window.count > allowance) throw new HttpException('Inténtalo en unos minutos.', 429);
    this.rate.set(id, window);
  }

  async register(input: Registration) {
    const email = input.email.trim().toLowerCase();
    this.limit('register-email', email, 3);
    if (input.consentVersion !== CONSENT_VERSION || !input.name.trim()) {
      throw new BadRequestException('Confirma las condiciones y escribe tu nombre.');
    }
    const plan = await this.db.plan.findFirst({ where: { code: input.plan, enabled: true } });
    if (!plan) throw new BadRequestException('Selecciona un plan disponible.');
    this.mail.available();
    const hash = await passwordHash(input.password);
    let user;
    try {
      user = await this.db.user.create({
        data: {
          email, name: input.name.trim(), passwordHash: hash, consentVersion: CONSENT_VERSION, consentAt: new Date(),
          membership: { create: { organization: { create: {
            name: input.company?.trim() || input.name.trim(),
            subscription: { create: { planCode: plan.code } },
          } } } },
        }, select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('El registro no está disponible para este correo. Usa Iniciar sesión, Reenviar verificación o Recuperar acceso.');
      }
      throw error;
    }
    try {
      const receipt = await this.issue(user.id, 'VERIFY_EMAIL');
      return { message: 'Consulta tu mensaje de verificación para activar la cuenta.', channel: receipt?.channel };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException('La cuenta quedó pendiente. Usa Reenviar verificación cuando el servicio de correo esté disponible.');
      }
      throw error;
    }
  }

  private async issue(userId: string, kind: AccountTokenKind) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId }, select: { email: true, verifiedAt: true, passwordHash: true },
      });
      if (!user?.passwordHash || !!user.verifiedAt !== (kind === 'RESET_PASSWORD')) return;

      const token = newToken();
      const data = {
        digest: digest(token),
        expiresAt: new Date(Date.now() + (kind === 'VERIFY_EMAIL' ? 86400 : 1800) * 1000),
      };
      await tx.accountToken.upsert({
        where: { userId_kind: { userId, kind } }, create: { ...data, userId, kind }, update: data,
      });
      return this.mail.send(user.email, kind, token);
    }, { timeout: 10000 });
  }

  async request(email: string, kind: AccountTokenKind) {
    email = email.trim().toLowerCase();
    this.limit(kind, email, 3);
    const channel = this.mail.available();
    const user = await this.db.user.findUnique({ where: { email }, select: { id: true, verifiedAt: true, passwordHash: true } });
    if (user?.passwordHash && !!user.verifiedAt === (kind === 'RESET_PASSWORD')) await this.issue(user.id, kind);
    return { message: 'Si el correo corresponde a una cuenta elegible, revisa el mensaje con los siguientes pasos.', channel };
  }

  private async consume(tx: Transaction, token: string, kind: AccountTokenKind) {
    const where = { digest: digest(token), kind, expiresAt: { gt: new Date() } };
    const ticket = await tx.accountToken.findFirst({ where });
    if (!ticket) throw new BadRequestException('El enlace venció o ya se utilizó.');
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ticket.userId} FOR UPDATE`;
    if ((await tx.accountToken.deleteMany({ where: { ...where, expiresAt: { gt: new Date() } } })).count !== 1) {
      throw new BadRequestException('El enlace venció o ya se utilizó.');
    }
    return ticket.userId;
  }

  async verify(token: string) {
    await this.db.$transaction(async tx => {
      const id = await this.consume(tx, token, 'VERIFY_EMAIL');
      await tx.user.update({ where: { id }, data: { verifiedAt: new Date() } });
    });
    return { message: 'Correo verificado. Ya puedes iniciar sesión.' };
  }

  async reset(token: string, password: string) {
    const hash = await passwordHash(password);
    await this.db.$transaction(async tx => {
      const id = await this.consume(tx, token, 'RESET_PASSWORD');
      await tx.user.update({ where: { id }, data: { passwordHash: hash } });
      await tx.accountSession.deleteMany({ where: { userId: id } });
    });
    return { message: 'Contraseña actualizada. Inicia sesión con la nueva contraseña.' };
  }

  async login(email: string, password: string) {
    email = email.trim().toLowerCase();
    this.limit('login-email', email, 8);
    const user = await this.db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, verifiedAt: true } });
    const [salt, expected] = user?.passwordHash?.split(':') ?? ['0'.repeat(32), '0'.repeat(128)];
    const derived = await key(password, salt);
    if (!user?.passwordHash || !timingSafeEqual(derived, Buffer.from(expected, 'hex'))) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    if (!user.verifiedAt) throw new ForbiddenException('Verifica el correo antes de iniciar sesión.');
    const token = newToken();
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
      if (current?.passwordHash !== user.passwordHash) throw new UnauthorizedException('Vuelve a iniciar sesión.');
      await tx.accountSession.create({ data: {
        digest: digest(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
      } });
    });
    console.log('[login] 200 user=' + email + ' tokenPrefix=' + token.slice(0, 8) + ' maxAge=' + SESSION_SECONDS);
    return { token, maxAge: SESSION_SECONDS };
  }

  async identity(authorization?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const tokenPrefix = token ? token.slice(0, 8) : '(vacío)';
    if (!tokenPattern.test(token)) {
      console.log('[identity] 401 token-invalido prefix=' + tokenPrefix + ' len=' + token.length + ' authHeader=' + (authorization ? 'sí' : 'no'));
      throw new UnauthorizedException('Inicia sesión.');
    }
    const session = await this.db.accountSession.findUnique({
      where: { digest: digest(token) },
      include: { user: { select: { id: true, name: true, email: true, verifiedAt: true, membership: {
        include: { organization: { include: { subscription: { include: { plan: { include: planInclude } } } } } },
      } } } },
    });
    const membership = session?.user.membership;
    const organization = membership?.organization;
    if (!session || session.expiresAt <= new Date() || !session.user.verifiedAt || !organization) {
      console.log('[identity] 401 reject prefix=' + tokenPrefix + ' session=' + !!session +
        ' expired=' + (session ? session.expiresAt <= new Date() : 'n/a') +
        ' verified=' + !!session?.user.verifiedAt + ' org=' + !!organization);
      throw new UnauthorizedException('Inicia sesión.');
    }
    console.log('[identity] 200 ok prefix=' + tokenPrefix + ' user=' + session.user.email);
    return {
      digest: session.digest, userId: session.user.id,
      name: session.user.name, email: session.user.email,
      role: membership.role, organization,
    };
  }

  async logout(authorization?: string) {
    const session = await this.identity(authorization);
    await this.db.accountSession.deleteMany({ where: { digest: session.digest } });
    return { message: 'Sesión cerrada.' };
  }
}

import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AccountTokenKind } from '@prisma/client';
import { createTransport } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';

export type AccountMessage = { recipient: string; kind: AccountTokenKind; url: string; subject: string; text: string };
type Channel = 'mailpit' | 'smtp';
type DeliveryReceipt = { channel: Channel };

export interface AccountMailTransport {
  available(): Channel;
  deliver(message: AccountMessage): Promise<DeliveryReceipt>;
}

export const ACCOUNT_MAIL_TRANSPORT = Symbol('ACCOUNT_MAIL_TRANSPORT');
export const ACCOUNT_MAIL_DEADLINE_MS = 6000;

function accountOrigin() {
  const value = process.env.AUTOQA_ACCOUNT_ORIGIN ?? 'http://localhost:3000';
  let origin;
  try { origin = new URL(value); } catch { throw new ServiceUnavailableException('Configura la URL de AutoQA para el correo.'); }
  if (value !== origin.origin || !['http:', 'https:'].includes(origin.protocol) ||
    (process.env.AUTOQA_DEPLOYMENT === 'hosted' && origin.protocol !== 'https:')) {
    throw new ServiceUnavailableException('Configura un origen válido para los enlaces de AutoQA.');
  }
  return origin.origin;
}

function smtpSettings(): { channel: 'mailpit' | 'smtp'; from: string; options: SMTPPool.Options } {
  const mode = process.env.AUTOQA_MAIL_MODE ?? 'disabled';
  const hosted = process.env.AUTOQA_DEPLOYMENT === 'hosted';
  const mailpit = (mode === 'mailpit' || mode === 'local') && !hosted;
  if (!mailpit && mode !== 'smtp') throw new ServiceUnavailableException('El servicio de correo todavía no está configurado.');

  const host = process.env.AUTOQA_SMTP_HOST?.trim() || (mailpit ? '127.0.0.1' : '');
  const port = Number(process.env.AUTOQA_SMTP_PORT || (mailpit ? '1025' : '587'));
  const from = process.env.AUTOQA_MAIL_FROM?.trim() || (mailpit ? 'no-reply@autoqa.local' : '');
  const user = process.env.AUTOQA_SMTP_USER;
  const pass = process.env.AUTOQA_SMTP_PASS;
  const secure = !mailpit && (process.env.AUTOQA_SMTP_SECURE ?? String(port === 465)) === 'true';

  if (!host || !/^[a-z0-9.:-]+$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^[^\s<>@]+@[^\s<>@]+$/.test(from) || (!mailpit && (!user || !pass))) {
    throw new ServiceUnavailableException('Revisa el host, puerto, remitente y credenciales SMTP de AutoQA.');
  }

  return { channel: mailpit ? 'mailpit' : 'smtp', from, options: {
    host, port, secure, requireTLS: !mailpit && !secure, ignoreTLS: mailpit,
    auth: mailpit ? undefined : { user, pass },
    pool: true, maxConnections: 1, maxMessages: 1,
    connectionTimeout: 3500, greetingTimeout: 3000, socketTimeout: 4500,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  } };
}

@Injectable()
export class SmtpAccountMailTransport implements AccountMailTransport {
  private readonly logger = new Logger(SmtpAccountMailTransport.name);

  available() { return smtpSettings().channel; }

  async deliver(message: AccountMessage): Promise<DeliveryReceipt> {
    const { channel, from, options } = smtpSettings();
    const transport = createTransport(options);
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ACCOUNT_MAIL_DEADLINE_MS);
      });
      const receipt = await Promise.race([timeout, transport.sendMail({
        from, to: message.recipient, subject: message.subject, text: message.text,
      })]);
      if (receipt.accepted.length !== 1 || receipt.rejected.length) throw new Error('recipient-rejected');
      return { channel };
    } catch (error) {
      const details = error as { code?: string; responseCode?: number; message?: string };
      const safeCodes = ['EAUTH', 'ECONNECTION', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'EENVELOPE', 'ETLS'];
      const reason = details.message === 'timeout' ? 'timeout'
        : safeCodes.includes(details.code ?? '') ? details.code
        : Number.isInteger(details.responseCode) && details.responseCode! >= 400 && details.responseCode! <= 599
          ? 'SMTP ' + details.responseCode
          : 'delivery-failed';
      this.logger.warn('Entrega SMTP fallida · ' + message.kind + ' · ' + reason);
      throw new ServiceUnavailableException('El servicio de correo no pudo aceptar el mensaje.');
    } finally {
      clearTimeout(timer);
      transport.close();
    }
  }
}

@Injectable()
export class AccountMail {
  constructor(@Inject(ACCOUNT_MAIL_TRANSPORT) private readonly transport: AccountMailTransport) {}

  available() {
    accountOrigin();
    return this.transport.available();
  }

  async send(email: string, kind: AccountTokenKind, token: string) {
    const verification = kind === 'VERIFY_EMAIL';
    const path = verification ? '/verificar' : '/restablecer';
    const url = accountOrigin() + path + '#token=' + token;
    const subject = verification ? 'Verifica tu correo de AutoQA' : 'Restablece tu contraseña de AutoQA';
    const time = verification ? '24 horas' : '30 minutos';
    return this.transport.deliver({
      recipient: email, kind, url, subject,
      text: subject + '.\n\nAbre este enlace de un solo uso:\n\n' + url + '\n\nEl enlace vence en ' + time + '.',
    });
  }

  async sendInvite(email: string, token: string, organizationName: string, role: string) {
    const url = accountOrigin() + '/invite/' + token;
    const subject = 'Te invitaron a ' + organizationName + ' en AutoQA';
    return this.transport.deliver({
      recipient: email, kind: 'VERIFY_EMAIL', url, subject,
      text: subject + '.\n\nRol asignado: ' + role + '.\n\nAcepta la invitación en:\n\n' + url +
        '\n\nEl enlace vence en 7 días. Si no la esperabas, ignora este mensaje.',
    });
  }
}

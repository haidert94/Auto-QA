import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Cifrado simétrico para credenciales de prueba almacenadas por cuenta.
// Formato: base64(iv(12) || tag(16) || ciphertext).
// La clave sale de AUTOQA_SECRET_KEY en hex (64 chars) o base64 (44 chars).
// Si no está definida, la API rechaza guardar credenciales con 500 explícito
// en vez de persistir texto plano silenciosamente.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function keyFromEnv(): Buffer | null {
  const raw = process.env.AUTOQA_SECRET_KEY?.trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  return decoded.length === 32 ? decoded : null;
}

@Injectable()
export class SecretCipher {
  private readonly key = keyFromEnv();

  get available(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new InternalServerErrorException(
        'AUTOQA_SECRET_KEY no está configurada; no se pueden guardar credenciales cifradas.',
      );
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  decrypt(blob: string): string {
    if (!this.key) {
      throw new InternalServerErrorException('AUTOQA_SECRET_KEY no está configurada.');
    }
    const buffer = Buffer.from(blob, 'base64');
    if (buffer.length < IV_LENGTH + TAG_LENGTH) {
      throw new InternalServerErrorException('Credencial cifrada con formato inválido.');
    }
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

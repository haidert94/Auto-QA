// Guarda capturas de pantalla fuera del repositorio con claves opacas.
// Clave = hex de 32 caracteres (igual que DocumentStorage del API).
// El backend se elige con AUTOQA_EXPLORATIONS_BACKEND (local|s3); la
// configuración S3 vive en apps/api/src/exploration/s3-config.ts para que
// worker y API compartan validaciones.

import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createS3ClientFromConfig, isS3Enabled, readS3Config, resolveObjectKey, type S3Config } from '../../api/src/exploration/s3-config';

const KEY = /^[0-9a-f]{32}$/;

export interface ScreenshotStorage {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalScreenshotStorage implements ScreenshotStorage {
  constructor(private readonly root: string = resolve(process.env.AUTOQA_EXPLORATIONS_DIR || join(process.cwd(), '.autoqa/explorations'))) {}

  private pathFor(key: string): string {
    if (!KEY.test(key)) throw new Error('Clave de captura no válida.');
    return join(this.root, key);
  }

  async put(data: Buffer): Promise<string> {
    const key = randomBytes(16).toString('hex');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.pathFor(key), data, { flag: 'wx', mode: 0o600 });
    return key;
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export class S3ScreenshotStorage implements ScreenshotStorage {
  constructor(private readonly client: S3Client, private readonly config: S3Config) {}

  private resolve(key: string): string {
    const objectKey = resolveObjectKey(this.config, key);
    if (!objectKey) throw new Error('Clave de captura no válida.');
    return objectKey;
  }

  async put(data: Buffer): Promise<string> {
    const key = randomBytes(16).toString('hex');
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.resolve(key),
      Body: data,
      ContentType: 'image/png',
      // Nunca public-read: la UI pasa siempre por el endpoint autenticado del API.
      ACL: 'private',
      CacheControl: 'private, max-age=86400',
    }));
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: this.resolve(key) }));
    if (!response.Body) throw new Error('Respuesta S3 sin cuerpo.');
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.resolve(key) }));
    } catch (error) {
      if (error instanceof NoSuchKey) return;
      if (error instanceof S3ServiceException && error.$metadata?.httpStatusCode === 404) return;
      throw error;
    }
  }
}

export function createScreenshotStorage(): ScreenshotStorage {
  if (!isS3Enabled()) return new LocalScreenshotStorage();
  const config = readS3Config();
  return new S3ScreenshotStorage(createS3ClientFromConfig(config), config);
}

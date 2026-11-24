// Lector de capturas en la API. El worker escribe con el adaptador equivalente
// de apps/explorer; aquí solo se lee. Ambos lados comparten:
//   - formato de clave (hex 32)
//   - configuración (apps/api/src/exploration/s3-config.ts)
//   - backend seleccionado por AUTOQA_EXPLORATIONS_BACKEND (local|s3)

import { GetObjectCommand, NoSuchKey, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createS3ClientFromConfig, isS3Enabled, KEY_PATTERN, readS3Config, resolveObjectKey, type S3Config } from './s3-config';

export interface ScreenshotReader {
  read(key: string): Promise<Buffer | null>;
}

@Injectable()
export class LocalScreenshotReader implements ScreenshotReader {
  private readonly root = resolve(
    process.env.AUTOQA_EXPLORATIONS_DIR || join(__dirname, '../../../../.autoqa/explorations'),
  );

  async read(key: string): Promise<Buffer | null> {
    if (!KEY_PATTERN.test(key)) return null;
    try {
      const file = await open(join(this.root, key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        return (await file.stat()).isFile() ? await file.readFile() : null;
      } finally {
        await file.close();
      }
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'EISDIR') return null;
      throw error;
    }
  }
}

export class S3ScreenshotReader implements ScreenshotReader {
  private readonly logger = new Logger(S3ScreenshotReader.name);
  constructor(private readonly client: S3Client, private readonly config: S3Config) {}

  async read(key: string): Promise<Buffer | null> {
    const objectKey = resolveObjectKey(this.config, key);
    if (!objectKey) return null;
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
      const body = response.Body;
      if (!body) return null;
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      if (error instanceof S3ServiceException && error.$metadata?.httpStatusCode === 404) return null;
      this.logger.error('No se pudo leer la captura en S3', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }
}

export function createScreenshotReader(): ScreenshotReader {
  if (!isS3Enabled()) return new LocalScreenshotReader();
  const config = readS3Config();
  return new S3ScreenshotReader(createS3ClientFromConfig(config), config);
}

export const SCREENSHOT_READER = Symbol('SCREENSHOT_READER');

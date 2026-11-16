// Lector de capturas en la API. El worker escribe con el adaptador equivalente
// de apps/explorer; aquí solo se lee. Comparten la convención de claves y el
// directorio en AUTOQA_EXPLORATIONS_DIR para que el futuro adaptador S3 sea el
// único punto de cambio.

import { Injectable } from '@nestjs/common';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const KEY = /^[0-9a-f]{32}$/;

export interface ScreenshotReader {
  read(key: string): Promise<Buffer | null>;
}

@Injectable()
export class LocalScreenshotReader implements ScreenshotReader {
  private readonly root = resolve(
    process.env.AUTOQA_EXPLORATIONS_DIR || join(__dirname, '../../../../.autoqa/explorations'),
  );

  async read(key: string): Promise<Buffer | null> {
    if (!KEY.test(key)) return null;
    const path = join(this.root, key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return readFile(path);
  }
}

export const SCREENSHOT_READER = Symbol('SCREENSHOT_READER');

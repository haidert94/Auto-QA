// Guarda capturas de pantalla fuera del repositorio con claves opacas.
// Clave = hex de 32 caracteres (igual que DocumentStorage del API para que
// el futuro adaptador S3 se pueda compartir).

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ScreenshotStorage {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalScreenshotStorage implements ScreenshotStorage {
  constructor(private readonly root: string = resolve(process.env.AUTOQA_EXPLORATIONS_DIR || join(process.cwd(), '.autoqa/explorations'))) {}

  private pathFor(key: string): string {
    if (!/^[0-9a-f]{32}$/.test(key)) throw new Error('Clave de captura no válida.');
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

import { Injectable } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

export interface DocumentStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

@Injectable()
export class LocalDocumentStorage implements DocumentStorage {
  private readonly root = resolve(process.env.AUTOQA_DOCUMENTS_DIR || join(__dirname, '../../../../.autoqa/documents'));

  constructor() {
    const web = resolve(__dirname, '../../../../apps/web');
    const insideWeb = relative(web, this.root);
    if (!insideWeb || (!insideWeb.startsWith('..' + sep) && insideWeb !== '..' && !isAbsolute(insideWeb))) {
      throw new Error('El almacenamiento de documentos debe quedar fuera de la aplicación web.');
    }
  }

  private path(key: string) {
    if (!/^[0-9a-f]{32}$/.test(key)) throw new Error('Clave de almacenamiento no válida.');
    return join(this.root, key);
  }

  async put(key: string, data: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(key);
    try {
      await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await this.remove(key).catch(() => undefined);
      throw error;
    }
  }

  get(key: string) {
    return readFile(this.path(key));
  }

  async remove(key: string) {
    try {
      await unlink(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

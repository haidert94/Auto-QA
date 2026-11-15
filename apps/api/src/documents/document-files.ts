import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { DocumentFormat } from '@prisma/client';
import { extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 5;
export const MAX_PROJECT_VERSIONS = 30;

export type SourceBlock = { locator: string; text: string; fields?: Record<string, string> };

export function documentFormat(name: string, size: number): DocumentFormat {
  if (name.length > 180 || /[/\\:\u0000-\u001f\u007f]/u.test(name) || name !== name.trim()) {
    throw new BadRequestException('El nombre del archivo no es válido.');
  }
  if (!size || size > MAX_FILE_BYTES) throw new BadRequestException('Cada archivo debe tener entre 1 byte y 5 MiB.');
  const format = extname(name).slice(1).toUpperCase();
  if (!Object.hasOwn(DocumentFormat, format)) throw new UnsupportedMediaTypeException('Formato de documento no admitido.');
  return DocumentFormat[format as keyof typeof DocumentFormat];
}

export function parseDocument(format: DocumentFormat, data: Buffer): Promise<SourceBlock[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'document-parser.worker.js'), {
      workerData: { format, data },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      stdout: true,
      stderr: true,
      env: {},
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const invalid = () => new UnsupportedMediaTypeException(
      'El contenido no corresponde al formato, está cifrado o supera los límites de lectura.',
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new BadRequestException('El documento excedió el tiempo de lectura.'));
    }, 12000);
    worker.once('message', (result: SourceBlock[] | null) => {
      clearTimeout(timeout);
      if (Array.isArray(result)) resolve(result);
      else reject(invalid());
    });
    worker.once('error', () => {
      clearTimeout(timeout);
      reject(invalid());
    });
    worker.once('exit', () => {
      clearTimeout(timeout);
      reject(invalid());
    });
  });
}

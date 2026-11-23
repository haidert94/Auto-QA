// Carga las variables del .env del root antes de instanciar cualquier
// módulo que dependa de process.env (PrismaClient, AiRouter, S3 storage).
// Hostinger inyecta las variables desde su dashboard, pero en el VPS
// corremos con PM2 que no lee .env por defecto. Node 20+ expone dotenv
// como builtin vía node:util/process, pero para evitar depender de la
// versión usamos un fs.readFileSync manual: barato y sin dependencias.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
try {
  const content = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const [, key, raw = ''] = match;
    if (process.env[key]) continue;
    const value = raw.replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
} catch {
  // Sin .env en el cwd: usar lo que ya tenga el proceso.
}

import { PrismaClient } from '@prisma/client';
import { runLoop } from './worker';

async function main() {
  const prisma = new PrismaClient();
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log('[explorer] señal recibida, parando…');
      controller.abort();
    });
  }
  try {
    await runLoop(prisma, { pollIntervalMs: 5000, signal: controller.signal });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[explorer] error fatal:', error);
  process.exit(1);
});

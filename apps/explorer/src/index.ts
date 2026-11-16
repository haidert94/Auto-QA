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

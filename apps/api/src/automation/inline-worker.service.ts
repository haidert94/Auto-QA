// Worker inline para entornos de deploy con un solo proceso (Hostinger).
// En esa topología no hay apps/explorer corriendo, así que los
// AutomationJob se quedan QUEUED para siempre y el wizard "Automatizar
// proyecto" se cae con "El worker no respondió a tiempo".
//
// Cuando AUTOQA_INLINE_WORKER=true, este servicio levanta un loop dentro
// del proceso NestJS: cada POLL_MS reclama el próximo job de la cola y
// lo ejecuta en el mismo proceso usando runAutomation (el mismo binario
// que corre el worker externo). También atiende UxAudit pendientes.
//
// Side effect: la carga de la generación corre en el mismo proceso que
// atiende las requests. Para pocos usuarios de demo, aceptable. Para
// escala real, el worker externo sigue existiendo y es la ruta
// recomendada.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { AiRouter } from '../ai/ai-router';
import { PrismaService } from '../prisma.service';
// Runner copiado al workspace de api para que el tsc no mueva el rootDir al
// common parent y rompa la ruta dist/app.js. Mantener sincronizado con
// apps/explorer/src/automation-runner.ts (ver nota abajo).
import { runAutomation, type AutomationClaim } from './pipeline-runner';

const POLL_MS = 3000;

@Injectable()
export class InlineWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InlineWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly router: AiRouter) {}

  onModuleInit() {
    if (process.env.AUTOQA_INLINE_WORKER !== 'true') {
      this.logger.log('[inline-worker] desactivado (AUTOQA_INLINE_WORKER != true)');
      return;
    }
    this.logger.log(`[inline-worker] activo, polling cada ${POLL_MS} ms`);
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const claim = await claimNextAutomation(this.prisma);
      if (claim) {
        this.logger.log(`[inline-worker] reclamo job=${claim.id} priorStage=${claim.priorStage}`);
        await runAutomation(this.prisma as unknown as PrismaClient, claim, this.router,
          (level, detail) => this.logger.log(`[inline-worker] ${level} ${detail}`));
      }
    } catch (error) {
      this.logger.warn(`[inline-worker] tick falló: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}

// Reproduce el SQL del worker externo (apps/explorer/src/worker.ts#claimNextAutomation).
// Mantenerlo acá evita importar módulos del explorer y arrastrar sus side
// effects a la boot del API.
async function claimNextAutomation(prisma: PrismaService): Promise<AutomationClaim | null> {
  const rows = await prisma.$queryRaw<AutomationClaim[]>`
    UPDATE "AutomationJob" j
    SET status = 'RUNNING', "startedAt" = now(),
        stage = CASE WHEN j.stage = 'pending' THEN 'claimed' ELSE j.stage END
    FROM (
      SELECT id, stage AS "priorStage" FROM "AutomationJob"
      WHERE status = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) picked
    WHERE j.id = picked.id
    RETURNING j.id, j."projectId", j.inputs, j."runKey", picked."priorStage";
  `;
  return rows[0] ?? null;
}

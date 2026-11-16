import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AiController } from './ai.controller';
import { AiRouter } from './ai-router';
import { BudgetService } from './budget.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [AiRouter, BudgetService],
  exports: [AiRouter, BudgetService],
})
export class AiModule {}

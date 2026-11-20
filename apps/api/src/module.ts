import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommerceModule } from './commerce/commerce.module';
import { DocumentsModule } from './documents/documents.module';
import { ExplorationsController } from './exploration/explorations.controller';
import { ExplorationsService } from './exploration/explorations.service';
import { PrismaModule } from './prisma.module';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { IcspController } from './icsp/icsp.controller';
import { IcspService } from './icsp/icsp.service';
import { IpaController } from './ipa/ipa.controller';
import { IpaService } from './ipa/ipa.service';
import { AiController } from './ai/ai.controller';
import { AiRouter } from './ai/ai-router';
import { BudgetService } from './ai/budget.service';
import { AutomationController } from './automation/automation.controller';
import { AutomationService } from './automation/automation.service';
import { InlineWorkerService } from './automation/inline-worker.service';
import { LoadController } from './load/load.controller';
import { LoadService } from './load/load.service';
import { MonitorsController } from './monitors/monitors.controller';
import { MonitorsService } from './monitors/monitors.service';
import { PerformanceController } from './performance/performance.controller';
import { PerformanceService } from './performance/performance.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { RunsController } from './runs/runs.controller';
import { RunsService } from './runs/runs.service';
import { ScenariosController } from './scenarios/scenarios.controller';
import { ScenariosService } from './scenarios/scenarios.service';
import { CodeHealthController } from './quality/code-health.controller';
import { CodeHealthService } from './quality/code-health.service';

@Module({
  imports: [ConfigModule.forRoot({ envFilePath: ['../../.env', '.env'], isGlobal: true }), PrismaModule, CommerceModule, DocumentsModule],
  controllers: [ProjectsController, ExplorationsController, ScenariosController, RunsController, IpaController, IcspController, ReportsController, PerformanceController, MonitorsController, LoadController, AiController, AutomationController, CodeHealthController],
  providers: [
    ProjectsService,
    ExplorationsService,
    ScenariosService,
    RunsService,
    IpaService,
    IcspService,
    ReportsService,
    PerformanceService,
    MonitorsService,
    LoadService,
    AiRouter,
    BudgetService,
    AutomationService,
    // El servicio se instancia siempre; el loop solo arranca cuando
    // AUTOQA_INLINE_WORKER=true. En Hostinger activamos este flag; en
    // local, se deja apagado y se corre el worker externo con `pnpm dev`.
    InlineWorkerService,
    CodeHealthService,
  ],
})
export class AppModule {}

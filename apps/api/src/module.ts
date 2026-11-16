import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommerceModule } from './commerce/commerce.module';
import { DocumentsModule } from './documents/documents.module';
import { ExplorationsController } from './exploration/explorations.controller';
import { ExplorationsService } from './exploration/explorations.service';
import { createScreenshotReader, SCREENSHOT_READER } from './exploration/screenshot-storage';
import { PrismaModule } from './prisma.module';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { IcspController } from './icsp/icsp.controller';
import { IcspService } from './icsp/icsp.service';
import { IpaController } from './ipa/ipa.controller';
import { IpaService } from './ipa/ipa.service';
import { PerformanceController } from './performance/performance.controller';
import { PerformanceService } from './performance/performance.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { RunsController } from './runs/runs.controller';
import { RunsService } from './runs/runs.service';
import { ScenariosController } from './scenarios/scenarios.controller';
import { ScenariosService } from './scenarios/scenarios.service';

@Module({
  imports: [ConfigModule.forRoot({ envFilePath: ['../../.env', '.env'], isGlobal: true }), PrismaModule, CommerceModule, DocumentsModule],
  controllers: [ProjectsController, ExplorationsController, ScenariosController, RunsController, IpaController, IcspController, ReportsController, PerformanceController],
  providers: [
    ProjectsService,
    ExplorationsService,
    ScenariosService,
    RunsService,
    IpaService,
    IcspService,
    ReportsService,
    PerformanceService,
    { provide: SCREENSHOT_READER, useFactory: () => createScreenshotReader() },
  ],
})
export class AppModule {}

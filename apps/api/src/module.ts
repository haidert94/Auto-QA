import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommerceModule } from './commerce/commerce.module';
import { DocumentsModule } from './documents/documents.module';
import { ExplorationsController } from './exploration/explorations.controller';
import { ExplorationsService } from './exploration/explorations.service';
import { LocalScreenshotReader, SCREENSHOT_READER } from './exploration/screenshot-storage';
import { PrismaModule } from './prisma.module';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { ScenariosController } from './scenarios/scenarios.controller';
import { ScenariosService } from './scenarios/scenarios.service';

@Module({
  imports: [ConfigModule.forRoot({ envFilePath: ['../../.env', '.env'], isGlobal: true }), PrismaModule, CommerceModule, DocumentsModule],
  controllers: [ProjectsController, ExplorationsController, ScenariosController],
  providers: [
    ProjectsService,
    ExplorationsService,
    ScenariosService,
    { provide: SCREENSHOT_READER, useClass: LocalScreenshotReader },
  ],
})
export class AppModule {}

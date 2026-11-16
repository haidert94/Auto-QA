import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommerceModule } from './commerce/commerce.module';
import { DocumentsModule } from './documents/documents.module';
import { ExplorationsController } from './exploration/explorations.controller';
import { ExplorationsService } from './exploration/explorations.service';
import { PrismaModule } from './prisma.module';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';

@Module({
  imports: [ConfigModule.forRoot({ envFilePath: ['../../.env', '.env'], isGlobal: true }), PrismaModule, CommerceModule, DocumentsModule],
  controllers: [ProjectsController, ExplorationsController],
  providers: [ProjectsService, ExplorationsService],
})
export class AppModule {}

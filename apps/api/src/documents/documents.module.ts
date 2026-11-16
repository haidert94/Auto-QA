import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { DocumentsController } from './documents.controller';
import { DOCUMENT_STORAGE, LocalDocumentStorage } from './document-storage';
import { RuleBasedDocumentAnalyzer } from './document-analysis';
import { DocumentsService, DOCUMENT_ANALYZER } from './documents.service';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    { provide: DOCUMENT_STORAGE, useClass: LocalDocumentStorage },
    { provide: DOCUMENT_ANALYZER, useClass: RuleBasedDocumentAnalyzer },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}

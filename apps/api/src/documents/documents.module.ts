import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma.module';
import { AiDocumentAnalyzer } from './ai-document-analyzer';
import { DocumentsController } from './documents.controller';
import { DOCUMENT_STORAGE, LocalDocumentStorage } from './document-storage';
import { DocumentsService, DOCUMENT_ANALYZER } from './documents.service';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    { provide: DOCUMENT_STORAGE, useClass: LocalDocumentStorage },
    // La IA toma el análisis; si no hay API key o el plan no incluye
    // AI_DOCUMENT_ANALYSIS, el propio AiDocumentAnalyzer delega en el
    // analizador por reglas.
    { provide: DOCUMENT_ANALYZER, useClass: AiDocumentAnalyzer },
  ],
  // Exportamos también el storage para que otros módulos (p.ej.
  // AutomationService) puedan leer los documentos directamente del storage
  // y empaquetarlos como base64 en jobs destinados a workers remotos.
  exports: [DocumentsService, DOCUMENT_STORAGE],
})
export class DocumentsModule {}

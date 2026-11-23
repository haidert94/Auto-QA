import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post,
  UploadedFiles, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { DocumentType } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ALL_TEST_TYPES } from '../automation/test-types';
import { DocumentErrorsFilter } from './document-errors.filter';
import { RequiresPlanCapability, RequiresRole, WorkspaceGuard } from '../commerce/workspace.guard';
import { MAX_FILES_PER_UPLOAD, MAX_FILE_BYTES } from './document-files';
import { DocumentsService, type UploadedDocument } from './documents.service';

class UploadDocumentDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['AUTO', ...Object.values(DocumentType)])
  type?: DocumentType | 'AUTO';

  // Multipart entrega 'testTypes' como string o string[]; lo normalizo
  // antes de validar para aceptar ambas formas.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [value]; }
      catch { return [value]; }
    }
    return [];
  })
  @IsArray()
  @ArrayMaxSize(16)
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(ALL_TEST_TYPES, { each: true })
  testTypes?: string[];
}

class ReclassifyDocumentDto {
  @IsArray()
  @ArrayMaxSize(16)
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(ALL_TEST_TYPES, { each: true })
  testTypes!: string[];
}

class ReviewDocumentDto {
  @IsUUID()
  versionId!: string;

  @IsBoolean()
  validated!: boolean;
}

@Controller('projects/:projectId/documents')
@UseGuards(WorkspaceGuard)
@UseFilters(DocumentErrorsFilter)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @RequiresRole('EDITOR')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
    preservePath: true,
    limits: { files: MAX_FILES_PER_UPLOAD, fileSize: MAX_FILE_BYTES, fields: 2, fieldSize: 256, parts: MAX_FILES_PER_UPLOAD + 3 },
  }))
  upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFiles() files: UploadedDocument[],
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documents.upload(projectId, files ?? [], dto?.type ?? 'AUTO', dto?.testTypes ?? []);
  }

  // Reclasifica un documento ya subido: actualiza su lista de tipos de
  // prueba sin alterar versiones ni archivos.
  @Patch(':documentId/test-types')
  @RequiresRole('EDITOR')
  reclassify(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReclassifyDocumentDto,
  ) {
    return this.documents.reclassify(projectId, documentId, dto.testTypes);
  }

  @Get()
  list(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.documents.list(projectId);
  }

  @RequiresPlanCapability('IPA')
  @Get('analysis')
  analysis(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.documents.report(projectId);
  }

  @RequiresRole('EDITOR')
  @RequiresPlanCapability('DOCUMENT_ANALYSIS')
  @Post('analyze')
  @HttpCode(200)
  analyze(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.documents.analyze(projectId);
  }

  @Get(':documentId')
  get(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.documents.get(projectId, documentId);
  }

  @Patch(':documentId/validation')
  @RequiresRole('ADMIN')
  review(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.documents.review(projectId, documentId, dto);
  }

  @Delete(':documentId')
  @HttpCode(204)
  @RequiresRole('ADMIN')
  remove(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.documents.remove(projectId, documentId);
  }
}

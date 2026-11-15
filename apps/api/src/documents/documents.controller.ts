import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post,
  UploadedFiles, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { DocumentType } from '@prisma/client';
import { IsBoolean, IsIn, IsUUID, ValidateIf } from 'class-validator';
import { DocumentErrorsFilter } from './document-errors.filter';
import { RequiresPlanCapability, WorkspaceGuard } from '../commerce/workspace.guard';
import { MAX_FILES_PER_UPLOAD, MAX_FILE_BYTES } from './document-files';
import { DocumentsService, type UploadedDocument } from './documents.service';

class UploadDocumentDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['AUTO', ...Object.values(DocumentType)])
  type?: DocumentType | 'AUTO';
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
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
    preservePath: true,
    limits: { files: MAX_FILES_PER_UPLOAD, fileSize: MAX_FILE_BYTES, fields: 1, fieldSize: 64, parts: MAX_FILES_PER_UPLOAD + 2 },
  }))
  upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFiles() files: UploadedDocument[],
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documents.upload(projectId, files ?? [], dto?.type ?? 'AUTO');
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
  review(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.documents.review(projectId, documentId, dto);
  }

  @Delete(':documentId')
  @HttpCode(204)
  remove(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.documents.remove(projectId, documentId);
  }
}

import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type DocumentType, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { convertDocument } from '../automation/document-converter';
import { analyzeFindings, classifyDocument, type DocumentAnalysisProvider, type Finding } from './document-analysis';
import { documentFormat, MAX_PROJECT_VERSIONS, parseDocument } from './document-files';
import { analysisSelect, describeAnalysis, documentAnalysisSignature, documentSelect, metadata, persistFindings, readDocumentSnapshot } from './document-records';
import { DOCUMENT_STORAGE, type DocumentStorage } from './document-storage';
import { readiness, type ReadinessFinding } from './readiness';

type AnalysisFindingRow = Prisma.RequirementTraceabilityGetPayload<{
  select: { id: true; kind: true; text: true; pendingConfirmation: true; pendingReason: true; requirementId: true; locator: true;
    version: { select: { id: true; number: true; document: { select: { id: true; filename: true } } } } };
}>;

function toReadinessFinding(row: AnalysisFindingRow): ReadinessFinding {
  return {
    id: row.id,
    kind: row.kind,
    pendingConfirmation: row.pendingConfirmation,
    text: row.text,
    locator: row.locator,
    documentId: row.version.document.id,
    documentFilename: row.version.document.filename,
    versionId: row.version.id,
    versionNumber: row.version.number,
    requirementId: row.requirementId,
  };
}

export const DOCUMENT_ANALYZER = Symbol('DOCUMENT_ANALYZER');

export type UploadedDocument = { originalname: string; buffer: Buffer };

type Transaction = Prisma.TransactionClient;
const active = { removedAt: null };
const projectRelations = { environments: true, roles: true } satisfies Prisma.ProjectInclude;

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function filename(name: string) {
  if ([...name].some(char => char.charCodeAt(0) > 255)) return name.normalize('NFC');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1')).normalize('NFC');
  } catch {
    return name.normalize('NFC');
  }
}

@Injectable()
export class DocumentsService {
  private workers = 0;
  private readonly analyzing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENT_ANALYZER) private readonly analyzer: DocumentAnalysisProvider,
  ) {}

  private async project(projectId: string, canWrite = false, tx: Transaction = this.prisma) {
    const found = await tx.project.findUnique({ where: { id: projectId }, include: projectRelations });
    if (!found) throw new NotFoundException('Proyecto no encontrado.');
    if (canWrite && found.status === 'ARCHIVED') throw new ConflictException('El proyecto está archivado.');
    return found;
  }

  private async lockProject(tx: Transaction, projectId: string) {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    await this.project(projectId, true, tx);
  }

  private async parsing<T>(task: () => Promise<T>) {
    if (this.workers >= 2) throw new ServiceUnavailableException('Hay archivos en procesamiento. Inténtalo en unos segundos.');
    this.workers++;
    try {
      return await task();
    } finally {
      this.workers--;
    }
  }

  async upload(projectId: string, files: UploadedDocument[], type: DocumentType | 'AUTO') {
    if (!files.length) throw new BadRequestException('Selecciona al menos un documento.');
    await this.project(projectId, true);
    const prepared = files.map(file => {
      const name = filename(file.originalname);
      return { name, format: documentFormat(name, file.buffer.length), data: file.buffer, hash: digest(file.buffer) };
    });
    if (new Set(prepared.map(file => file.name)).size !== prepared.length) {
      throw new BadRequestException('Sube las versiones del mismo documento una por una.');
    }
    await this.parsing(async () => {
      for (const file of prepared) await parseDocument(file.format, file.data);
    });

    const written: string[] = [];
    try {
      return await this.prisma.$transaction(async tx => {
        await this.lockProject(tx, projectId);
        let count = await tx.documentVersion.count({ where: { document: { projectId } } });
        const uploads = [];
        for (const file of prepared) {
          const current = await tx.document.findFirst({
            where: { projectId, filename: file.name, ...active },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
          });
          if (current?.versions[0]?.sha256 === file.hash) {
            const duplicates = await tx.document.update({
              where: { id: current.id }, select: documentSelect,
              data: type === 'AUTO' ? {} : { type, classificationSource: 'MANUAL' },
            });
            uploads.push(metadata(duplicates));
            continue;
          }
          if (++count > MAX_PROJECT_VERSIONS) throw new ConflictException('El proyecto alcanzó el límite de 30 versiones.');
          const storageKey = randomBytes(16).toString('hex');
          await this.storage.put(storageKey, file.data);
          written.push(storageKey);
          const number = current ? current.version + 1 : 1;
          const classification = {
            type: type === 'AUTO' ? 'OTHER' : type,
            classificationSource: type === 'AUTO' ? 'PENDING' : 'MANUAL',
          } as const;
          const version = { number, format: file.format, size: file.data.length, sha256: file.hash, storageKey, uploadedAt: new Date() };
          const document = current
            ? await tx.document.update({
              where: { id: current.id }, select: documentSelect,
              data: { ...classification, version: number, versions: { create: version } },
            })
            : await tx.document.create({
              data: { ...classification, projectId, filename: file.name, versions: { create: version } },
              select: documentSelect,
            });
          uploads.push(metadata(document));
        }
        return uploads;
      }, { timeout: 15000 });
    } catch (error) {
      // A committed version wins if the connection dropped after COMMIT.
      for (const key of written) {
        try {
          if (!(await this.prisma.documentVersion.findUnique({ where: { storageKey: key }, select: { id: true } }))) {
            await this.storage.remove(key);
          }
        } catch { /* Preserve the blob if its commit state cannot be established. */ }
      }
      throw error;
    }
  }

  private rows(projectId: string, tx: Transaction = this.prisma) {
    return tx.document.findMany({
      where: { projectId, ...active }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: documentSelect,
    });
  }

  async list(projectId: string) {
    await this.project(projectId);
    return (await this.rows(projectId)).map(metadata);
  }

  async get(projectId: string, documentId: string) {
    const item = await this.prisma.document.findFirst({
      where: { projectId, id: documentId, ...active }, select: documentSelect,
    });
    if (!item) throw new NotFoundException('Documento no encontrado.');
    return metadata(item);
  }

  async review(projectId: string, documentId: string, input: { versionId: string; validated: boolean }) {
    return this.prisma.$transaction(async tx => {
      await this.lockProject(tx, projectId);
      const document = await tx.document.findFirst({ where: { id: documentId, projectId, ...active }, select: documentSelect });
      if (!document) throw new NotFoundException('Documento no encontrado.');
      const current = document.versions[0];
      if (!current || current.id !== input.versionId) throw new ConflictException('La versión del documento cambió.');
      if (!current.processedAt || !current.hasText) throw new ConflictException('Para validar el archivo, primero procesa una versión con texto.');
      await tx.documentVersion.update({
        where: { id: current.id }, data: { validatedAt: input.validated ? current.validatedAt ?? new Date() : null },
      });
      return metadata(await tx.document.findUniqueOrThrow({ where: { id: documentId }, select: documentSelect }));
    });
  }

  async remove(projectId: string, documentId: string) {
    const keys = await this.prisma.$transaction(async tx => {
      await this.lockProject(tx, projectId);
      const document = await tx.document.findFirst({
        where: { id: documentId, projectId }, include: { versions: { select: { storageKey: true } } },
      });
      if (!document) throw new NotFoundException('Documento no encontrado.');
      if (!document.removedAt) {
        await tx.document.update({ where: { id: documentId }, data: { removedAt: new Date() } });
        await tx.documentAnalysis.deleteMany({ where: { projectId, versions: { some: { documentId } } } });
      }
      return document.versions.flatMap(version => version.storageKey ? [version.storageKey] : []);
    });
    try {
      for (const key of keys) await this.storage.remove(key);
      await this.prisma.document.deleteMany({ where: { id: documentId, projectId, removedAt: { not: null } } });
    } catch {
      throw new ServiceUnavailableException('El documento dejó de estar visible. Reintenta su eliminación para completar la limpieza.');
    }
  }

  async report(projectId: string) {
    return this.prisma.$transaction(async tx => {
      const project = await this.project(projectId, false, tx);
      const documents = await this.rows(projectId, tx);
      const signature = documentAnalysisSignature(await readDocumentSnapshot(tx, projectId));
      const record = await tx.documentAnalysis.findUnique({
        where: { projectId_signature: { projectId, signature } }, select: analysisSelect,
      });
      const findings = (record?.findings ?? []).map(toReadinessFinding);
      return { analysis: describeAnalysis(record), ipa: readiness(project, documents, findings) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async analyze(projectId: string) {
    const project = await this.project(projectId, true);
    if (this.analyzing.has(projectId)) throw new ConflictException('El proyecto ya tiene un análisis en curso.');
    this.analyzing.add(projectId);
    // runKey une todas las llamadas de IA de este análisis para la auditoría
    // y el reporte de consumo por operación.
    const runKey = `doc-analysis:${randomBytes(8).toString('hex')}`;
    const context = { organizationId: project.organizationId, projectId, runKey };
    try {
      const snapshot = await readDocumentSnapshot(this.prisma, projectId);
      const signature = documentAnalysisSignature(snapshot);
      if (await this.prisma.documentAnalysis.findUnique({
        where: { projectId_signature: { projectId, signature } }, select: { id: true },
      })) return this.report(projectId);

      const files = snapshot.flatMap(document => {
        const version = document.versions[0];
        return version?.uploadedAt && version.storageKey && version.format
          ? [{ document, version, key: version.storageKey, format: version.format }] : [];
      });
      if (!files.length) throw new BadRequestException('Carga al menos un documento antes de solicitar el análisis.');

      const warnings: string[] = [];
      const facts: Finding[] = [];
      const processed = await this.parsing(async () => {
        const processedFiles = [];
        const deadline = Date.now() + 42000;
        for (const file of files) {
          if (Date.now() > deadline) throw new UnprocessableEntityException('El análisis superó el tiempo disponible.');
          const content = await this.storage.get(file.key).catch(() => {
            throw new UnprocessableEntityException('No se pudo leer una versión almacenada.');
          });
          if (digest(content) !== file.version.sha256) throw new UnprocessableEntityException('Una versión no coincide con su huella.');
          const blocks = await parseDocument(file.format, content);
          // Convertimos a Markdown para que el analyzer con IA trabaje
          // sobre texto natural (historias de usuario, listas, tablas) y
          // no sobre blocks + locators. Un fallo de conversión degrada al
          // rule-based (que seguirá usando blocks).
          let markdown: string | undefined;
          try {
            const converted = await convertDocument({ filename: file.document.filename, bytes: content });
            markdown = converted.markdown;
          } catch { /* sin markdown: cae al rule-based automáticamente */ }
          const findings = await this.analyzer.extract(
            { versionId: file.version.id, blocks, markdown, filename: file.document.filename },
            context,
          ).catch(() => {
            throw new UnprocessableEntityException('Un documento supera el límite de elementos para el análisis.');
          });
          facts.push(...findings);
          if (facts.length > 1200) throw new UnprocessableEntityException('El análisis supera el límite de 1200 elementos de origen.');
          if (!blocks.length) warnings.push(file.document.filename + ' · sin texto extraíble.');
          else if (!findings.length) warnings.push(file.document.filename + ' · sin requisitos ni otros elementos reconocidos.');
          processedFiles.push({
            documentId: file.document.id, versionId: file.version.id, type: classifyDocument(findings, blocks), hasText: blocks.length > 0,
          });
        }
        if (Date.now() > deadline) throw new UnprocessableEntityException('El análisis superó el tiempo disponible.');
        return processedFiles;
      });
      const findings = analyzeFindings(facts);
      await this.prisma.$transaction(async tx => {
        await this.lockProject(tx, projectId);
        if (signature !== documentAnalysisSignature(await readDocumentSnapshot(tx, projectId))) {
          throw new ConflictException('Los documentos cambiaron durante el análisis. Solicítalo de nuevo.');
        }
        if (await tx.documentAnalysis.findUnique({
          where: { projectId_signature: { projectId, signature } }, select: { id: true },
        })) return;
        const record = await tx.documentAnalysis.create({
          data: { projectId, signature, warnings, versions: { connect: processed.map(file => ({ id: file.versionId })) } },
        });
        const now = new Date();
        for (const file of processed) {
          await tx.documentVersion.update({
            where: { id: file.versionId }, data: { processedAt: now, hasText: file.hasText },
          });
          await tx.document.updateMany({
            where: { id: file.documentId, classificationSource: { not: 'MANUAL' } },
            data: { type: file.type, classificationSource: 'AUTOMATIC' },
          });
        }
        await persistFindings(tx, projectId, record.id, findings);
        const persisted = await tx.documentAnalysis.findUnique({
          where: { id: record.id }, select: analysisSelect,
        });
        const enriched = (persisted?.findings ?? []).map(toReadinessFinding);
        const ipa = readiness(await this.project(projectId, false, tx), await this.rows(projectId, tx), enriched);
        await tx.qualityAssessment.create({
          data: { projectId, analysisId: record.id, type: 'READINESS', score: ipa.score, details: ipa },
        });
      }, { timeout: 15000 });
      return this.report(projectId);
    } finally {
      this.analyzing.delete(projectId);
    }
  }
}

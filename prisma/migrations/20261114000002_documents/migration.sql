BEGIN;

-- CreateEnum
CREATE TYPE "DocumentFormat" AS ENUM ('PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'MD', 'JSON', 'YAML', 'YML');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('PENDING', 'MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "FindingKind" AS ENUM ('USER_STORY', 'FUNCTIONAL', 'NON_FUNCTIONAL', 'REQUIREMENT', 'ACCEPTANCE_CRITERION', 'BUSINESS_RULE', 'ROLE', 'PERMISSION', 'SCENARIO', 'AMBIGUITY', 'CONTRADICTION');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "classificationSource" "ClassificationSource" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "removedAt" TIMESTAMP(3),
ALTER COLUMN "storageKey" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "analysisId" TEXT,
ADD COLUMN     "kind" "FindingKind";

-- AlterTable
ALTER TABLE "QualityAssessment" ADD COLUMN     "analysisId" TEXT;

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "format" "DocumentFormat",
    "size" INTEGER,
    "sha256" TEXT,
    "storageKey" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "hasText" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAnalysis" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "warnings" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceCriterion" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "requirementId" TEXT,
    "text" TEXT NOT NULL,

    CONSTRAINT "AcceptanceCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessRule" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "BusinessRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementTraceability" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "FindingKind" NOT NULL,
    "text" TEXT NOT NULL,
    "pendingConfirmation" BOOLEAN NOT NULL,
    "versionId" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "relatedVersionId" TEXT,
    "relatedLocator" TEXT,
    "requirementId" TEXT,
    "criterionId" TEXT,
    "ruleId" TEXT,

    CONSTRAINT "RequirementTraceability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DocumentAnalysisToDocumentVersion" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DocumentAnalysisToDocumentVersion_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_number_key" ON "DocumentVersion"("documentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAnalysis_projectId_signature_key" ON "DocumentAnalysis"("projectId", "signature");

-- CreateIndex
CREATE INDEX "AcceptanceCriterion_analysisId_idx" ON "AcceptanceCriterion"("analysisId");

-- CreateIndex
CREATE INDEX "BusinessRule_analysisId_idx" ON "BusinessRule"("analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementTraceability_analysisId_ordinal_key" ON "RequirementTraceability"("analysisId", "ordinal");

-- CreateIndex
CREATE INDEX "_DocumentAnalysisToDocumentVersion_B_index" ON "_DocumentAnalysisToDocumentVersion"("B");

-- CreateIndex
CREATE INDEX "Document_projectId_filename_removedAt_idx" ON "Document"("projectId", "filename", "removedAt");

-- CreateIndex
CREATE INDEX "Requirement_analysisId_idx" ON "Requirement"("analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityAssessment_analysisId_key" ON "QualityAssessment"("analysisId");

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnalysis" ADD CONSTRAINT "DocumentAnalysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "DocumentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceCriterion" ADD CONSTRAINT "AcceptanceCriterion_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "DocumentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceCriterion" ADD CONSTRAINT "AcceptanceCriterion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRule" ADD CONSTRAINT "BusinessRule_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "DocumentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTraceability" ADD CONSTRAINT "RequirementTraceability_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "DocumentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTraceability" ADD CONSTRAINT "RequirementTraceability_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTraceability" ADD CONSTRAINT "RequirementTraceability_relatedVersionId_fkey" FOREIGN KEY ("relatedVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTraceability" ADD CONSTRAINT "RequirementTraceability_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTraceability" ADD CONSTRAINT "RequirementTraceability_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "AcceptanceCriterion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTraceability" ADD CONSTRAINT "RequirementTraceability_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "BusinessRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityAssessment" ADD CONSTRAINT "QualityAssessment_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "DocumentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DocumentAnalysisToDocumentVersion" ADD CONSTRAINT "_DocumentAnalysisToDocumentVersion_A_fkey" FOREIGN KEY ("A") REFERENCES "DocumentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DocumentAnalysisToDocumentVersion" ADD CONSTRAINT "_DocumentAnalysisToDocumentVersion_B_fkey" FOREIGN KEY ("B") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Legacy metadata represents a declaration until a file is uploaded again.
UPDATE "Document" SET "classificationSource" = 'MANUAL';
INSERT INTO "DocumentVersion" ("id", "documentId", "number")
SELECT gen_random_uuid()::text, "id", "version" FROM "Document";

COMMIT;

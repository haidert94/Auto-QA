ALTER TABLE "Document" ADD COLUMN "testTypesSource" "ClassificationSource" NOT NULL DEFAULT 'PENDING';

UPDATE "Document" SET "testTypesSource" = 'MANUAL' WHERE cardinality("testTypes") > 0;

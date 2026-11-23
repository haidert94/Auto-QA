ALTER TABLE "RequirementTraceability" ADD COLUMN "clarification" JSONB;
ALTER TABLE "TestScenario" ADD COLUMN "requirementReviewRequiredAt" TIMESTAMP(3);

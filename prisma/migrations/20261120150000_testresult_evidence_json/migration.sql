-- Añade TestResult.evidence para el manifiesto de evidencias por paso
-- (trace + video + screenshots). Convive con evidenceKey por compat.
ALTER TABLE "TestResult" ADD COLUMN "evidence" JSONB;

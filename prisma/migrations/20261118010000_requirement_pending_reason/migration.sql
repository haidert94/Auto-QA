-- Añade el motivo opcional que la IA entrega al marcar un finding como
-- pendingConfirmation. Null para los findings legacy y los generados por
-- el analizador por reglas.
ALTER TABLE "RequirementTraceability"
  ADD COLUMN "pendingReason" TEXT;

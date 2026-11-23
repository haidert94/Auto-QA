-- Añade la lista opcional de tipos de prueba a los que aplica cada
-- documento. Vacío = General (aplica a todos los tipos habilitados del
-- plan). Documentos existentes quedan sin clasificar (General) por el
-- default.

ALTER TABLE "Document" ADD COLUMN "testTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

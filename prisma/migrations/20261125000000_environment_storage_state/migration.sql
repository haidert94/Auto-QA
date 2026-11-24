-- Sesión reusable de Playwright por entorno. El QA humano se loguea en su
-- navegador, exporta cookies+localStorage como JSON y lo sube; el worker lo
-- inyecta con test.use({ storageState }) para que los tests no se logueen de
-- nuevo. Tres consideraciones:
--   - storageState es efectivamente un token de sesión activo. Lo ciframos con
--     el mismo SecretCipher (AES-256-GCM) que usamos para credentialCipher,
--     en una columna TEXT con base64(iv||tag||ciphertext). Nunca entra a logs,
--     prompts de IA ni Git.
--   - storageStateExpiresAt fuerza rotación: pasado ese timestamp el worker
--     ignora el blob y los tests vuelven a loguearse (o fallan si no hay
--     fallback). Null = sin TTL, desaconsejado para producción.
--   - storageStateLabel es una nota libre del QA ("QA admin", "cliente demo")
--     para auditar qué sesión está vigente sin leer el blob.
ALTER TABLE "Environment"
  ADD COLUMN "storageStateCipher"     TEXT,
  ADD COLUMN "storageStateLabel"      TEXT,
  ADD COLUMN "storageStateUploadedAt" TIMESTAMP(3),
  ADD COLUMN "storageStateExpiresAt"  TIMESTAMP(3);

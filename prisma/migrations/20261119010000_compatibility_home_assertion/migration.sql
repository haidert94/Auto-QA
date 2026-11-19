-- Repara únicamente las variantes de la plantilla de inicio que guardaban solo la navegación.
UPDATE "TestScenario"
SET "steps" = jsonb_set(
      "steps",
      '{0,action}',
      to_jsonb(regexp_replace("steps"->0->>'action', '^navigate: ', 'expect-http-ok: '))
    ),
    "expectedResult" = 'La página de inicio responde con un estado HTTP exitoso (2xx).'
WHERE "title" IN (
    '[COMPAT:CHROMIUM] Página de inicio accesible',
    '[COMPAT:FIREFOX] Página de inicio accesible',
    '[COMPAT:WEBKIT] Página de inicio accesible'
  )
  AND "tags" @> ARRAY['@compatibility']::text[]
  AND NOT ("tags" @> ARRAY['@manual']::text[])
  AND "expectedResult" = 'La página de inicio carga sin errores.'
  AND "steps" @> '[{"ordinal":1}]'::jsonb
  AND "steps"->1 IS NULL
  AND "steps"->0->>'action' ~ '^navigate: https?://[^[:space:]]+$';

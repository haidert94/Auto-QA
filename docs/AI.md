# IA en AutoQA

AutoQA integra modelos de lenguaje (LLM) para operaciones donde el valor
supera al costo: analizar documentos, sugerir escenarios y explicar
fallos de pruebas. La IA **no reemplaza** las reglas mecánicas que ya
funcionan; las complementa cuando el plan del cliente la incluye.

## Operaciones que usan IA

| Operación | Capability requerida | Cuándo se dispara |
|---|---|---|
| Análisis semántico de documentos | `AI_DOCUMENT_ANALYSIS` | El usuario pide "Analizar con IA" sobre una versión de documento |
| Clasificación automática de documentos | `AI_DOCUMENT_ANALYSIS` | Detrás de escena cuando sube un documento |
| Generación de escenarios desde requisitos | `AI_SCENARIO_GENERATION` | Botón "Sugerir escenarios" en un requisito |
| Explicación de un fallo | `AI_FAILURE_EXPLANATION` | Botón "¿Por qué falló?" en un TestResult con status FAILED |

## Proveedores soportados

| Modelo | Proveedor | Precio aprox. (USD / M tokens) | Uso recomendado |
|---|---|---|---|
| `claude-haiku-4-5` | Anthropic | 0.80 in / 4.00 out | Volumen alto, análisis simple (Essentials) |
| `claude-sonnet-4-5` | Anthropic | 3.00 in / 15.00 out | Default, mejor balance calidad/costo (Professional+) |
| `gpt-4o-mini` | OpenAI | 0.15 in / 0.60 out | Alternativa económica (opcional) |
| `gpt-4o` | OpenAI | 2.50 in / 10.00 out | Alternativa premium (opcional) |
| `rule-based` | — | 0 | Fallback cuando no hay plan IA o API key |

## Configuración

Variables de entorno (en el API o worker que sirva peticiones de IA):

```ini
# Al menos una API key según el modelo elegido:
AUTOQA_ANTHROPIC_API_KEY=sk-ant-...
AUTOQA_OPENAI_API_KEY=sk-...

# Modelo default para operaciones que no especifiquen uno (fallback a
# claude-sonnet-4-5 si no se declara). Valores aceptados: claude-haiku-4-5,
# claude-sonnet-4-5, gpt-4o, gpt-4o-mini.
AUTOQA_AI_DEFAULT_MODEL=claude-sonnet-4-5
```

Si no se configura ninguna API key, todas las operaciones caen al
`RuleBasedProvider`, que devuelve un mensaje informativo y marca
`usedFallback = true`. No se cobra consumo, no se bloquea el flujo.

## Presupuesto por organización

Cada mes, la organización tiene un límite de tokens que viene del plan:

| Plan | Tokens/mes | Modelo |
|---|---|---|
| Essentials | 500.000 | Haiku |
| Professional | 3.000.000 | Sonnet |
| Business | 15.000.000 | Sonnet (eligible Opus futuro) |
| Enterprise | ilimitado | A elección + BYOK |

El límite vive en `PlanCapability(code=AI_DOCUMENT_ANALYSIS).monthlyLimit`.
Cuando se agota:

- Las operaciones nuevas caen al `RuleBasedProvider` sin cobrar.
- La UI muestra "Presupuesto IA del mes agotado. Actualiza de plan."
- El consumo se reinicia el día 1 del mes siguiente.

El uso actual se consulta en `GET /ai/budget`:

```json
{
  "monthKey": "2026-11",
  "aiTokensUsed": 450000,
  "aiTokensLimit": 500000,
  "aiCostCop": 2100,
  "remainingTokens": 50000
}
```

## Trazabilidad

Cada llamada queda en `MeteredAi` con: `organizationId, projectId,
operation, model, inputTokens, outputTokens, costCop, runKey`. Permite
auditar el consumo y, si un cliente lo pide, mostrar el detalle operación
por operación.

`OrgBudget(organizationId, monthKey)` resume el agregado del mes para la
consulta rápida del dashboard.

## BYOK (Bring Your Own Key) — pendiente

Plan Enterprise permitirá que el cliente provea su propia API key de
Anthropic u OpenAI. El router la usaría en lugar de la clave global y el
costo se descuenta de su factura con el proveedor, no de la nuestra.

Diseño previsto: modelo `OrgIntegration { organizationId, provider,
encryptedKey }` con cifrado AES-GCM usando una master key en env.
Implementación queda para la próxima iteración.

## Fallback por error

Si el proveedor responde con 5xx, timeout o error de red, el router NO
cobra y devuelve el fallback. Esto evita cargarle al cliente consumo
por una falla del proveedor. Los errores se logean para seguimiento.

## Seguridad de prompts

- El contenido del documento o del requisito se envía tal cual al
  proveedor. **No se filtran credenciales ni PII** en esta iteración.
  Los clientes que no quieran enviar datos sensibles deben:
  - Redactar los documentos antes de subirlos, o
  - Esperar el feature de "redacción automática" (futuro), o
  - Usar un plan sin IA y quedarse con el fallback rule-based.
- El prompt del sistema es fijo y vive en el código de AutoQA. Nunca se
  acepta prompt injection desde el documento del cliente — se envía
  como payload, no como instrucción.

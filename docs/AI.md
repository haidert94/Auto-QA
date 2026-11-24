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
| Preparación de código Playwright | `AI_SCENARIO_GENERATION` | **Generar seleccionados** en Automatización, sobre los escenarios guardados |
| Explicación de un fallo | `AI_FAILURE_EXPLANATION` | Al abrir **Reportes → Evidencias** de un resultado fallido o bloqueado con un error registrado, o al pulsar **¿Por qué falló?** en el escenario |

## Corrección de automatizaciones

Tras un fallo de un escenario Playwright con código guardado, Explorer observa el localizador del paso fallido en los marcos del entorno autorizado. Cuando encuentra una coincidencia única y puede identificar la ruta del iframe, el agente de corrección prepara un cambio que conserva las acciones y aserciones del caso. **Aplicar solución** valida y guarda el cambio para la automatización que produjo el fallo. La comprobación funcional se realiza en la siguiente ejecución que confirme el usuario.

## Proveedores soportados

| Modelo | Proveedor | Precio aprox. (USD / M tokens) | Uso recomendado |
|---|---|---|---|
| `claude-haiku-4-5` | Anthropic | 0.80 in / 4.00 out | Volumen alto, análisis simple (Essentials) |
| `claude-sonnet-4-5` | Anthropic | 3.00 in / 15.00 out | Default, mejor balance calidad/costo (Professional+) |
| `gpt-4o-mini` | OpenAI | 0.15 in / 0.60 out | Alternativa económica (opcional) |
| `gpt-4o` | OpenAI | 2.50 in / 10.00 out | Alternativa premium (opcional) |
| `rule-based` | — | 0 | Fallback cuando no hay plan IA o API key |

## Modelo por operación (mezcla óptima)

AutoQA **no usa un único modelo para todo**. El router asigna el
modelo según la complejidad de la operación:

| Operación | Modelo default | Por qué |
|---|---|---|
| `document-classification` | `claude-haiku-4-5` | Tarea simple, Haiku acierta al 10% del costo |
| `failure-explanation` | `claude-haiku-4-5` | 3-5 bullets, no requiere razonamiento |
| `document-analysis` | `claude-sonnet-4-5` | Requiere entender estructura y matices |
| `scenario-generation` | `claude-sonnet-4-5` | Creativo + JSON estructurado |

Override por operación vía env var (opcional):

```ini
AUTOQA_AI_MODEL_CLASSIFY=claude-haiku-4-5
AUTOQA_AI_MODEL_EXPLAIN=claude-haiku-4-5
AUTOQA_AI_MODEL_ANALYZE=claude-sonnet-4-5
AUTOQA_AI_MODEL_SUGGEST=claude-sonnet-4-5
```

## Fallback en cascada

Si el proveedor primario falla (timeout, 5xx, error de red), el router
intenta automáticamente el **equivalente del otro proveedor**:

| Primario | Alternativo |
|---|---|
| `claude-haiku-4-5` | `gpt-4o-mini` |
| `claude-sonnet-4-5` | `gpt-4o` |
| `gpt-4o-mini` | `claude-haiku-4-5` |
| `gpt-4o` | `claude-sonnet-4-5` |

Si ambos fallan o ninguno está configurado, cae al `RuleBasedProvider`.
No se cobra consumo por una falla externa.

## Prompt caching (Anthropic)

El `system` block se envía con `cache_control: { type: 'ephemeral' }`.
Anthropic cachea el bloque por 5 minutos; los hits cuestan ~10 % del
precio input normal. Como los prompts de sistema de AutoQA son fijos
por operación, el ahorro real está entre 50 % y 90 % en producción.

El `BudgetService` contabiliza el costo efectivo (ya con descuento),
no el teórico.

## Configuración

Variables de entorno (en el API o worker que sirva peticiones de IA):

```ini
# Al menos una API key según el modelo elegido. Si configuras ambas,
# el router usa el equivalente del otro como fallback automático.
AUTOQA_ANTHROPIC_API_KEY=sk-ant-...
AUTOQA_OPENAI_API_KEY=sk-...

# Fallback global cuando una operación no tiene modelo asignado.
# Valores: claude-haiku-4-5 | claude-sonnet-4-5 | gpt-4o | gpt-4o-mini.
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

El límite vive en `PlanCapability(code=AI_DOCUMENT_ANALYSIS).monthlyLimit`. Enterprise usa `null` para representar un plan sin límite mensual de IA y mantiene el registro de consumo. Para un plan con límite, si la cuota estimada disponible es insuficiente, la generación informa ese motivo y deja los casos pendientes. El consumo se contabiliza por mes calendario UTC.

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

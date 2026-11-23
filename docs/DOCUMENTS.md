# Documentación, requisitos e IPA

## Uso desde AutoQA

En **Registrar aplicación**, selecciona o arrastra archivos en **Documentación y requisitos**. La lista muestra el formato, el tamaño y el estado. Puedes quitar una selección o asignarle una categoría antes de guardar. Con **Automática**, la categoría se asigna en el primer análisis. El registro admite proyectos sin documentos.

Al guardar un proyecto nuevo, AutoQA lo crea antes de cargar los archivos seleccionados. Si una carga falla, el proyecto guardado conserva su identificador y el archivo queda en la lista local con el error. Puedes reintentar desde **Subir archivos** de la sección correspondiente. En un proyecto existente, ese botón carga los pendientes sin guardar los demás campos del formulario.

En un proyecto con registro completo, abre **Datos → Documentos asociados y contratos técnicos**. Cada tipo de prueba y **General** tienen su propio botón **Cargar archivo**. Al seleccionar los archivos, AutoQA los sube y guarda el tipo correspondiente. Si un archivo falla, puedes corregir su clasificación, volver a intentar la carga o quitarlo. Usa **Aplica a** en un archivo guardado si debe aparecer en varios tipos.

Pulsa **Analizar documentación** para leer las versiones actuales y consulta **Hallazgos y fuentes**. Después de revisar un documento procesado con texto, puedes marcarlo como validado o retirar su validación. Esa revisión se aplica a la versión indicada. Un archivo con el mismo nombre y contenido que la versión actual se reutiliza. Cambiar el contenido con el mismo nombre crea una versión nueva.

## Configuración local en Windows

Las cuentas comerciales acceden con su sesión y una suscripción vigente. Los proyectos anteriores pueden usar la clave de 32 bytes en hexadecimal cuando se habilita `AUTOQA_LEGACY_MODE=true` para la evaluación local. Para activarla, ejecuta desde la raíz en PowerShell. El ejemplo conserva una clave válida existente y no la muestra:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
$lines = @(Get-Content -LiteralPath .env)
if (-not ($lines -match '^AUTOQA_DOCUMENTS_TOKEN=[a-f0-9]{64}$')) {
  $localDocumentKey = node -p "require('node:crypto').randomBytes(32).toString('hex')"
  $lines = @($lines | Where-Object { $_ -notmatch '^AUTOQA_DOCUMENTS_TOKEN=' })
  $lines + "AUTOQA_DOCUMENTS_TOKEN=$localDocumentKey" | Set-Content -LiteralPath .env -Encoding utf8
  Remove-Variable localDocumentKey
}
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:deploy
```

Reinicia NestJS y Next.js. Mantén la API y la web en localhost. La web reenvía las solicitudes documentales desde el servidor Next.js con la clave del `.env` raíz. El navegador usa una ruta del mismo origen. El proxy comprueba el origen en escrituras y solo envía la clave al API HTTP configurado en loopback. Para clientes de la API directa, utiliza el encabezado `Authorization: Bearer <clave>`.

La clave autoriza el acceso documental de la instalación local. Cada consulta y mutación restringe sus resultados al proyecto de la ruta. Los proyectos archivados permiten consultas y bloquean mutaciones. El control por usuario, por rol de AutoQA y por tenant corresponde a seguridad base. El consentimiento para probar un entorno y el permiso de gestionar sus documentos son controles distintos.

El almacenamiento predeterminado es `.autoqa/documents` en la raíz del proyecto, excluido de Git. Puedes elegir un directorio privado con `AUTOQA_DOCUMENTS_DIR`, preferiblemente una ruta absoluta. Haz respaldo de la base y los archivos a la vez para conservar la relación entre versiones y blobs. Usa archivos sintéticos para probar la carga y el borrado.

## Contrato HTTP

Base de las rutas `/api/projects/:projectId/documents`.

| Método | Sufijo | Comportamiento |
| --- | --- | --- |
| POST | raíz | Recibe multipart con archivos en `files` y un `type` opcional. Devuelve metadatos. |
| GET | raíz | Lista archivos, clasificación, estados y versiones del proyecto. |
| GET | `/:documentId` | Devuelve metadatos de un documento del proyecto. |
| DELETE | `/:documentId` | Elimina el documento, sus versiones y los análisis que utilizaban sus fuentes. |
| POST | `/analyze` | Analiza el conjunto actual o reutiliza el informe para ese mismo conjunto de versiones. |
| GET | `/analysis` | Obtiene el análisis vigente y el IPA calculado con el estado actual. |
| PATCH | `/:documentId/validation` | Actualiza la revisión con el JSON `{"versionId":"<uuid>","validated":true}`. |

Usa `AUTO`, `USER_STORY`, `REQUIREMENTS`, `ACCEPTANCE_CRITERIA`, `BUSINESS_RULE`, `FLOW`, `API` u `OTHER` como clasificación. Cada lote de API usa la misma clasificación. La interfaz manda solicitudes individuales para permitir categorías diferentes y reintentos por archivo.

Prueba con el identificador de un proyecto local y una ruta a un Markdown sintético en PowerShell 7:

```powershell
$projectId = '<uuid del proyecto>'
$uri = "http://127.0.0.1:3001/api/projects/$projectId/documents"
$keyLine = Get-Content -LiteralPath .env | Where-Object { $_ -match '^AUTOQA_DOCUMENTS_TOKEN=' } | Select-Object -Last 1
$headers = @{ Authorization = 'Bearer ' + ($keyLine -replace '^AUTOQA_DOCUMENTS_TOKEN=', '') }
$attachment = Get-Item -LiteralPath 'C:\ruta\requisitos-sinteticos.md'
$document = @(Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Form @{ files = $attachment; type = 'AUTO' })[0]
Invoke-RestMethod -Uri $uri -Headers $headers
Invoke-RestMethod -Uri "$uri/$($document.id)" -Headers $headers
Invoke-RestMethod -Uri "$uri/analyze" -Headers $headers -Method Post
```

## Formatos y fuentes

- PDF con capa de texto · página y línea de lectura.
- DOCX · párrafo del cuerpo principal, incluidas tablas.
- XLSX · hoja, fila y encabezados. La extracción usa valores guardados en la hoja.
- CSV · encabezados y filas con al menos dos columnas, separadas por coma, punto y coma o tabulación.
- TXT y Markdown · línea. Markdown admite secciones y líneas identificadas.
- JSON, YAML y YML · ruta dentro de la estructura. Se reconocen campos de tipo, clave, texto y referencias de requisito, así como operaciones OpenAPI como candidatos pendientes.

Ejemplo para un Markdown de prueba:

```markdown
Historia de usuario: Como lector quiero ver mis facturas.
RF-1: Mostrar el total de la factura.
Criterio de aceptación: [RF-1] La factura muestra el total.
RNF-1: Cargar el detalle en menos de 2 segundos.
RN-1: La moneda de facturación es COP.
Rol: Lector
Permiso: El lector puede consultar sus facturas.
```

El motor incluye fuentes por versión y localizador. Busca discrepancias entre documentos que usan la misma clave explícita y marca esas coincidencias como posibles contradicciones. Las inferencias y asociaciones por proximidad quedan pendientes. Un criterio explícito puede vincularse mediante una referencia como `[RF-1]`, un campo `requirementId` o un bloque estructurado anidado. Se registran expresiones vagas y requisitos que carecen de criterios explícitos reconocidos. La interfaz del analizador admite adaptadores de IA en el futuro. El proveedor actual usa reglas locales y trabaja sin conexión externa.

Los límites son 5 MiB por archivo, cinco archivos por lote de API, 30 versiones por proyecto, 100 páginas PDF, un máximo de 24 MiB expandidos y 300 entradas por archivo Office, 4 000 bloques y 300 000 caracteres extraídos por archivo, y 1 200 elementos de origen por análisis. El analizador procesa de forma síncrona con límites de tiempo y memoria en el lector. Los PDF escaneados requieren OCR externo al módulo o una copia con texto. La detección de contradicciones semánticas sin clave y las integraciones con proveedores de IA quedan pendientes.

## Persistencia y borrado

La migración registra los documentos antiguos como **Declarados** con su versión histórica. Para procesarlos, vuelve a subir el archivo. Los originales cargados usan claves opacas y se guardan fuera de la web. Los workers solo leen el contenido y no ejecutan macros, fórmulas ni las instrucciones incorporadas a un archivo.

Cada informe almacena requisitos, criterios, reglas, trazabilidad y un IPA asociado. Subir una versión invalida la vista del informe hasta analizar el nuevo conjunto. Borrar un documento elimina las evaluaciones que lo usaban. Si falla la limpieza de blobs, la API devuelve `503` y oculta el documento. Reintenta `DELETE` con el mismo identificador para completar la limpieza.

## Verificación

En una terminal con `AUTOQA_TEST_DATABASE_URL` apuntando a una base de pruebas ya migrada:

```powershell
npm.cmd run test:documents
npm.cmd run test:onboarding
```

La primera suite prueba los nueve formatos con muestras sintéticas, rechazos, autorización, pertenencia, versionado, clasificación, análisis, revisión y borrado real. Usa [el modelo de calidad](QUALITY_MODEL.md) para interpretar el IPA.

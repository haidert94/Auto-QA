# AutoQA

AutoQA registra aplicaciones web autorizadas y su configuración de QA. Esta entrega permite crear, consultar y editar el registro desde una interfaz en español o desde la API. Lee [la visión del producto](docs/PRODUCT_VISION.md), [los requisitos](docs/REQUIREMENTS.md), [la arquitectura](docs/ARCHITECTURE.md), [el modelo de calidad](docs/QUALITY_MODEL.md) y [el roadmap](docs/ROADMAP.md) para conocer el proyecto completo.

## Arranque en Windows

Usa PowerShell, Node.js 22.13 o posterior y Docker Desktop. Desde la raíz del proyecto, con Docker Desktop iniciado:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
docker compose up -d
docker compose ps
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:deploy
```

Espera a que PostgreSQL figure como `healthy` antes de aplicar las migraciones. Si ya tienes una instancia local de PostgreSQL, configura `DATABASE_URL` en `.env` y comienza desde `npm.cmd ci`. La aplicación requiere una base existente. Para verificar el esquema y compilar ambos espacios de trabajo:

```powershell
npx.cmd prisma validate
npm.cmd run build
```

El build incluye las migraciones. `npm.cmd run db:deploy` usa una conexión directa para Prisma CLI: prioriza `DIRECT_URL`, después `DATABASE_URL_UNPOOLED`; si solo existe una URL Neon con `-pooler`, deriva su endpoint directo conservando base, esquema y TLS. La aplicación conserva su `DATABASE_URL` original. En PostgreSQL local no necesitas otra variable. Los errores `P1002` de bloqueo se reintentan hasta tres veces; si persisten, el build falla. No se desactiva el bloqueo ni se omiten migraciones. Consulta [despliegue y diagnóstico P1002](docs/DEPLOY.md#conexión-directa-y-bloqueos-de-migraciones-p1002). Pruebas del script: `npm.cmd run test:deploy` (sin base de datos).

Abre dos terminales PowerShell en la raíz:

| Terminal | Comando |
| --- | --- |
| API | `npm.cmd run dev:api` |
| Web | `npm.cmd run dev:web` |

Abre [AutoQA](http://localhost:3000). La API escucha en `127.0.0.1:3001` y la interfaz en `127.0.0.1:3000`. Si cambias el puerto de la API, ajusta `PORT` en el `.env` de la raíz y ajusta `AUTOQA_INTERNAL_API_URL=http://127.0.0.1:<puerto>/api` en ese mismo archivo. Si cambias el origen de la web, ajusta `WEB_ORIGIN` en el `.env` de la raíz. Reinicia ambos servicios después de cambiar sus variables.

## Diseño del detalle de proyecto

Abre **Proyectos**, selecciona una aplicación con registro completo y entra en **Datos**. La vista usa dos columnas: entornos y alcance, documentos y roles a la izquierda; IPA y diagnóstico del registro a la derecha. En móvil las tarjetas se apilan. Los borradores conservan el formulario de registro.

La barra superior de la zona autenticada ocupa todo el ancho: logo a la izquierda, navegación central, organización y plan asignado a la derecha, y menú de cuenta con icono azul. El nombre y correo están dentro del menú. La organización se mantiene visible aunque coincida con el nombre del usuario; si no hay plan, no se muestra una insignia inventada. En móvil la navegación se abre con **Menú**.

En **Escenarios**, la lista permite buscar por título, ID, requisito o paso (atajo `Ctrl+K`), filtrar por etiquetas y presencia de resultados, seleccionar casos y abrir su detalle lateral. El listado muestra 10 escenarios por página de forma predeterminada y permite elegir 20 o 30 en los controles al final del listado. La búsqueda y los filtros se aplican al listado completo. Encima del listado, **Seleccionar visibles** actúa sobre la página actual y muestra el total seleccionado y la cantidad visible. **Nuevo escenario** y **Editar escenario** permiten gestionar los casos del proyecto. El editor muestra pasos en lenguaje natural con palabras clave Gherkin como **Dado**, **Cuando** y **Entonces**. Al escribir, el editor sugiere pasos guardados en el proyecto. El campo aparece en naranja cuando no encuentra coincidencias y permite guardar el paso nuevo. Los pasos modificados se pueden volver a automatizar desde **Automatización**. La papelera del detalle pide dos confirmaciones antes de borrar ese escenario y sus ejecuciones y resultados. **Eliminar escenarios** borra los casos marcados, incluidos los de otras páginas, tras confirmar la selección. Detén las ejecuciones en cola o en curso de esos casos antes de borrarlos. **Exportar set** ofrece CSV, JSON, PDF, Excel y Feature (`.feature`) para los escenarios seleccionados o para todos cuando no hay selección. Las palabras clave Gherkin se infieren de los pasos y deben revisarse. **Ejecutar suite** muestra los casos en una lista con casillas. La confirmación envía los casos marcados con el modo autorizado del entorno; presenta cada respuesta y respeta rechazos de autorización, plan y cuota del backend. El diálogo muestra **Procesando** hasta que termina el último escenario. Al alcanzar el límite simultáneo, los casos restantes esperan turno y se envían al liberarse cupo mientras la página del proyecto sigue abierta. **Cerrar** oculta el seguimiento y **Ver suite** lo vuelve a abrir. **Ver reporte** se habilita al finalizar y abre la pestaña **Reportes** del proyecto. Muestra el resultado registrado de cada caso al finalizar y los rechazos del plan o de cuota al recibirlos. La generación con IA continúa disponible en el desplegable inferior.

Para superar el IPA, vincula los criterios de aceptación a su historia o requisito y asocia los escenarios activos. El IPA queda bloqueado por debajo de 70 cuando falta esa trazabilidad. Los agentes de generación guardan únicamente casos asociados a requisitos confirmados con criterios, incluidas las pruebas de Calidad. Los vínculos de Calidad se almacenan con la migración `20261123140000_quality_requirement_links`.

**Generar casos de prueba** muestra primero los tipos marcados en **Aplica a** en los documentos de **Datos**. Confirma la selección para generar esos tipos. Si falta una selección o el plan no admite algún tipo marcado, la generación queda pendiente. La generación guarda `@regresion` en los nuevos escenarios web o móviles que el agente identifica para volver a comprobar un comportamiento existente después de cambios. Los casos de compatibilidad heredan las etiquetas del escenario base y aparecen con `@compatibilidad`. El filtro de Escenarios muestra las etiquetas presentes en los casos.

En **Escenarios**, la lista incluye monitores, auditorías Lighthouse, pruebas de carga y auditorías UX del proyecto con pasos en español, resultado esperado, estado y etiquetas `@disponibilidad`, `@performance` o `@ux`. Sus tarjetas muestran la configuración y enlazan a los resultados en **Reportes**. **Automatización** también muestra estas pruebas y admite filtrarlas por Calidad o por etiqueta. «Generar seleccionados» admite una selección mixta. Prepara Playwright para Funcional web, Mobile emulado y Compatibilidad. Las filas de Calidad ofrecen un archivo descargable por prueba: comprobación HTTP con Node.js para Disponibilidad, script de Lighthouse o k6 para Performance, y captura más prompt de análisis Nielsen y WCAG con Playwright para UX. Cada tipo tiene un agente de automatización. Playwright, Disponibilidad, Lighthouse, k6 y UX preparan sus archivos en paralelo por tipo y procesan en orden los casos de cada grupo. Disponibilidad, Lighthouse y k6 usan la configuración autorizada. UX usa la IA del proyecto para priorizar comprobaciones de una lista permitida y aplica un conjunto base cuando la IA no está disponible. Valida la sintaxis y guarda el archivo preparado o el motivo por el que requiere revisión. AutoQA realiza la evaluación asistida por IA al ejecutar la auditoría UX. Aplica también la migración `20261123130000_quality_automation_agents` para almacenar archivos y motivos de revisión. Cuando la URL contiene parámetros, el script los lee de `AUTOQA_TARGET_QUERY` al ejecutarlo. Aplica la migración `20261123120000_quality_automation` para guardar el estado de generación. Generar código no inicia ejecuciones. Marca las pruebas desde **Escenarios** o **Automatización** y ajusta la selección en **Ejecutar suite**. La selección puede combinar pruebas de navegador, Disponibilidad, Lighthouse, Carga y UX. En la confirmación se puede revisar la configuración guardada de las pruebas de calidad. El entorno elegido en el diálogo se aplica a las pruebas de navegador. Cada prueba de calidad usa su entorno y destino guardados. La corrida muestra en una lista el estado de todas las pruebas marcadas. Actualiza también Explorer al desplegar este cambio.

Al ejecutar una suite, AutoQA usa el motor de cada variante de compatibilidad y lo registra en Reportes. La ficha individual propone ese motor. El plan determina qué navegadores pueden ejecutarse.

Los escenarios generados para Playwright incluyen al menos una aserción ejecutable. El caso base de compatibilidad verifica que la página responda con HTTP 2xx. **Generar casos de prueba** también guarda como `@manual` las comprobaciones web o móviles que el agente fundamenta en el análisis y que requieren intervención humana. Usa los requisitos del análisis vigente cuando están disponibles. El caso queda visible en Escenarios con instrucciones en español y resultado esperado. La etiqueta permite filtrar esos casos y los excluye de Playwright.

**Permitir cambios con datos de prueba** está disponible al registrar o editar un entorno de Desarrollo, QA o Preproducción. Actívalo y confirma la autorización de ese entorno para ejecutar flujos que crean registros u órdenes de prueba. En el diálogo **Ejecutar suite**, **Configurar cambios con datos de prueba** abre la configuración del entorno seleccionado y permite volver a la misma suite al guardar. El runner valida el permiso confirmado al encolar y las rutas autorizadas. En Producción, las pruebas usan solo lectura.

Datos y Escenarios comparten el mismo contenedor, márgenes, tipografía y cabecera sobre el fondo marfil. Cambiar de pestaña conserva la alineación del nombre y del contenido; solamente cambian las acciones y la información de la sección.

En **Automatización**, busca por título, ID, paso o archivo y filtra por etiquetas y estado del código. Usa los controles al final del listado para mostrar 10, 20 o 30 escenarios por página. **Seleccionar visibles** actúa sobre la página actual y conserva los casos marcados en otras páginas o fuera del filtro. Sobre la lista se muestra el avance de la suite iniciada en la página, con pruebas finalizadas, en ejecución, en cola, pendientes de envío y sin resultado confirmado. Sin una suite en seguimiento, se muestra la actividad del proyecto. Si las pruebas esperan al runner durante un minuto o más, se indica la antigüedad de la primera en cola. **Detener ejecución** cancela los casos en cola y solicita detener las pruebas activas. Las pruebas activas aparecen como deteniéndose hasta que el runner registra la cancelación. Al entrar o recargar, la lista usa el estado guardado de cada escenario. En el bloque superior **Generar código Playwright**, **Generar seleccionados** pide al agente de IA convertir los pasos y resultados esperados en acciones de Playwright. El botón se deshabilita cuando todos los escenarios marcados tienen código guardado. AutoQA conserva las acciones completas y usa esa versión al encolar la prueba. Si el agente deja un caso pendiente, su fila indica que requiere revisión. El despliegue aplica la migración de automatización de escenarios antes de iniciar la API y el Explorer. Los indicadores distinguen pendiente, generando, generado, revisión y error. **Ejecutar suite** abre la confirmación existente para los seleccionados sin pendientes detectados, en un proyecto completo y con un entorno autorizado. El backend mantiene sus controles de pertenencia, plan, cuota y alcance. La cabecera y el ancho se comparten con Datos y Escenarios.

Playwright separa los datos de formulario escritos en el paso con ` | ` y los pasa como argumentos. Los casos guardados importan `autoqa-steps.ts`, que define cada acción con el mismo selector o destino una sola vez por proyecto. En la vista de código del escenario puedes consultar y copiar el módulo compartido. Calidad cuenta los pasos repetidos pendientes de automatizar y los que ya se comparten.

En **Reportes**, la vista inicial muestra el último estado de cada escenario. Al volver a ejecutarlo se actualizan su fila y los contadores. Desde el selector puedes consultar el historial o abrir una ejecución específica. Filtra por estado, etiqueta actual o error y cambia entre tabla, cronología y matriz. Las pruebas en cola o en curso muestran su progreso. Cuando se confirma una cancelación, la ejecución desaparece del historial y se excluye de las exportaciones. Reportes excluye las ejecuciones de escenarios archivados anteriormente. La vista **Todas** reúne los escenarios y los resultados de calidad. **Evidencias** abre las capturas por paso, el video y la traza que haya guardado cada ejecución. Para casos manuales, muestra las notas e imágenes adjuntas. Los resultados de calidad incluyen las comprobaciones de Disponibilidad, el informe de rendimiento, el resumen de carga y los hallazgos y la captura de UX cuando están disponibles. **Exportar resultados** genera JUnit XML o JSON de las ejecuciones finalizadas visibles una vez que el proyecto queda sin pruebas en cola ni en curso. Para lanzar otra ejecución, usa **Ejecutar suite** desde Escenarios o Automatización. La vista de escenarios también muestra los resultados manuales registrados. La tasa de éxito usa resultados registrados y muestra su denominador; los tiempos ausentes se distinguen de cero. Flakiness, reintentos y cobertura de aserciones muestran «No disponible» si no hay medición. El historial está limitado a las últimas 100 ejecuciones devueltas por la API. Puedes comprobar la vista y sus exportaciones con `npm.cmd run test:project-detail`.

En **Historial**, **Versiones finalizadas** muestra un estado vacío y **Logs** presenta la fecha de creación y, cuando es posterior, la última actualización del proyecto. **Exportar especificación** descarga un resumen JSON de alcance y permisos.

**Modificar**, **Adjuntar nuevo documento o especificación** y **Editar roles y permisos** abren las secciones del formulario existente. El selector permite consultar cada entorno sin cambiar su autorización. **Automatizar con IA** abre la pestaña de automatización y requiere las acciones y controles existentes para generar o ejecutar pruebas.

En **Calidad**, las tarjetas IPA e ICSP muestran los índices calculados por la API, sus dimensiones, brechas, estados documentales e históricos disponibles. La cabecera conserva el ancho, tamaño y fondo de las demás pestañas. Sin resultados de ejecución, ICSP muestra «Sin resultados de ejecución» y no atribuye salud al producto; las dimensiones sin denominador indican «Sin datos». La vista **Reportes → Calidad** reúne las comprobaciones de Disponibilidad, las métricas de Lighthouse y k6 y los hallazgos de UX. Incluye informes descargables y el historial de cada monitor, con hasta 100 registros recientes por tipo. Las pantallas de Calidad, Escenarios y Automatización enlazan al reporte y conservan las opciones de configuración. Los errores y restricciones de plan se presentan por sección. **Actualizar evaluación** consulta datos, **Exportar informe** descarga el JSON del endpoint existente o abre la impresión del navegador para guardar PDF. **Configurar auditoría** abre el flujo existente con sus controles de autorización; consultar esta pestaña no inicia escaneos ni pruebas.

Para comprobar la interfaz en Windows, con Node.js y Google Chrome instalados:

```powershell
npm.cmd run test:project-detail
```

Esta prueba compila solamente la web, inicia servidores temporales en loopback con una API simulada y verifica escritorio/móvil, teclado, exportación, documentos, edición y estados de error. No necesita PostgreSQL ni ejecuta migraciones. No comprueba persistencia ni motores IA. Guarda capturas en `%TEMP%\autoqa-project-detail-preview`; configura `AUTOQA_UI_SCREENSHOT_DIR` para elegir otra carpeta. Consulta [el alcance técnico de la vista](docs/PROJECT_DETAIL_UI.md).

Para revisar el nuevo diseño manualmente: abre `/projects/<id>#escenarios`, cambia un filtro, selecciona un caso y consulta el detalle; exporta y revisa el `.feature`; crea o edita un escenario sintético y recarga. El botón de ejecución abre una confirmación: cancelar no envía trabajos. Verificar una ejecución real requiere la API, la base y el worker configurados; la suite de interfaz no los sustituye.

## Página comercial, cuentas y suscripciones

La portada presenta un ejemplo de análisis documental con su fuente, los pasos de preparación y una comparativa de planes. La evaluación local permite verificar correo mediante Mailpit o un proveedor SMTP, activar una suscripción simulada y abrir proyectos de una organización. Para activar el flujo, repetir sus pruebas o consultar los requisitos de producción, usa [la guía comercial](docs/COMMERCIAL.md).

Los tres planes propuestos son Starter ($99.000 COP/mes), Pro ($299.000 COP/mes) y Business ($899.000 COP/mes). Aplica las migraciones para actualizar el catálogo de PostgreSQL y abre [la comparativa](http://localhost:3000/#precios). En **Facturación**, consulta los minutos de navegador usados y reservados y el límite mensual de tu organización. Enterprise muestra **Sin límite** cuando su catálogo define el uso de navegador como ilimitado. La portada indica qué capacidades están operativas y cuáles estarán disponibles próximamente. La cuota mensual de performance queda en cero hasta validar el valor y los controles de ejecución.

## Verificación de correo en Windows

Inicia Mailpit con Docker Desktop desde la raíz del proyecto.

```powershell
docker compose up -d mailpit
```

Para levantar también la base de datos, ejecuta `docker compose up -d postgres mailpit`. Configura el `.env` existente y reinicia la API.

```dotenv
AUTOQA_MAIL_MODE=mailpit
AUTOQA_SMTP_HOST=127.0.0.1
AUTOQA_SMTP_PORT=1025
AUTOQA_MAIL_FROM=no-reply@autoqa.local
AUTOQA_ACCOUNT_ORIGIN=http://localhost:3000
```

Si NestJS se ejecuta en un contenedor de la misma red que Mailpit, usa `AUTOQA_SMTP_HOST=mailpit`. El origen de cuenta siempre es la URL que abre el navegador.

Registra una cuenta de prueba o usa **Reenviar verificación** desde **Iniciar sesión** si la cuenta ya existe. Abre el mensaje en Mailpit, pulsa el enlace, confirma la verificación e inicia sesión. Los enlaces de verificación vencen a las 24 horas, se consumen una sola vez y un reenvío exitoso reemplaza al enlace anterior. Si el servicio SMTP rechaza un registro, la cuenta queda pendiente y puede volver a solicitar el mensaje. [Buzón de Mailpit](http://localhost:8025)

También puedes usar el binario oficial de Mailpit para Windows. Desde su carpeta ejecuta este comando, mantén Mailpit activo y arranca AutoQA normalmente. [Instalación de Mailpit](https://mailpit.axllent.org/docs/install/)

```powershell
.\mailpit.exe --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --database mailpit.db --allowed-hosts localhost,127.0.0.1
```

Para producción configura `AUTOQA_DEPLOYMENT=hosted`, `AUTOQA_MAIL_MODE=smtp` y un `AUTOQA_ACCOUNT_ORIGIN` HTTPS. Indica el servidor, puerto, remitente verificado y credenciales del proveedor con `AUTOQA_SMTP_HOST`, `AUTOQA_SMTP_PORT`, `AUTOQA_MAIL_FROM`, `AUTOQA_SMTP_USER` y `AUTOQA_SMTP_PASS`. El puerto 587 usa STARTTLS obligatorio. El 465 usa TLS desde la conexión. Para otros puertos puedes configurar `AUTOQA_SMTP_SECURE` según el proveedor. Mantén las credenciales en la configuración privada del servidor. [Opciones SMTP](https://nodemailer.com/smtp)

Con Mailpit y una base de pruebas migrada en `AUTOQA_TEST_DATABASE_URL`, puedes repetir la validación.

```powershell
npm.cmd run test:commerce
npm.cmd run test:commerce:e2e
```

## Verificar el registro en la web

1. En **Registrar aplicación**, escribe el nombre y pulsa **Guardar borrador**. Vuelve a **Proyectos**, abre el registro y comprueba que aparecen el estado y los campos pendientes. Pulsa **Completar registro** para comprobar que se bloquea mientras falten requisitos.
2. Declara un propietario, añade un entorno QA e introduce `https://qa.example.com/catalogo`. Selecciona **Privada**. Declara `qa.example.com` como dominio permitido, `qa.example.com/catalogo` como ruta permitida y `qa.example.com/catalogo/pagos` como exclusión. Agrega una acción prohibida y confirma la autorización después de definir el alcance. **Solo lectura** viene activado.
3. Añade un rol **Lector** con el permiso esperado **Catálogo / Ver / Permitido**. Puedes agregar otro permiso **Catálogo / Borrar / Denegado** y una referencia sintética `vault:qa/lector`. El registro admite modos **Pública**, **Privada** y **SSO**. Los dos últimos requieren roles con su matriz de permisos.
4. Agrega otro entorno con su URL, dominio, ruta y autorización. Declara módulos prioritarios y, si aplica, datos sintéticos, semillas, limpieza, integraciones, navegador, frecuencia, límites y preferencias de notificación.
5. Guarda con **Completar registro** y vuelve a abrirlo desde **Proyectos**. Verifica que se recuperan todos los entornos, prioridades, restricciones y permisos. Cambia una parte del alcance y comprueba que la interfaz desmarca la autorización de ese entorno. Prueba a excluir la URL base y a completar el registro para ver el rechazo. Puedes guardar los cambios como borrador y retomarlos después.

`READY` indica que se completaron los datos obligatorios del registro. La fase guarda declaraciones de autorización, políticas y preferencias. La verificación del titular de la aplicación, la bóveda, la navegación, la ejecución y las notificaciones pertenecen a fases posteriores. Ejecuta esta entrega localmente y usa datos sintéticos. Mantén fuera del formulario y del API las contraseñas, tokens y datos personales.


## Documentación y requisitos

En **Datos → Historias de usuario y Documentos asociados**, **General** ofrece un selector para subir archivos. Al subir un archivo, AutoQA lo convierte a Markdown para una revisión inicial local y marca en **Aplica a** los tipos de prueba que encuentra en su contenido. Cada archivo aparece una sola vez, con todos sus tipos visibles en **Aplica a**. Si el documento usa sugerencias automáticas, **Actualizar sugerencias** permite volver a evaluarlo sin subir otra versión. Para modificar esas casillas en un documento validado, retira primero la validación. La asignación manual se conserva al subir otra versión. El formulario de registro también admite seleccionar o arrastrar archivos. La tarjeta de IPA en Datos se actualiza al cambiar la documentación y muestra los datos disponibles y pendientes. Consulta [la guía documental](docs/DOCUMENTS.md) para configurar la clave local en Windows, probar cada ruta y entender los formatos y límites.

## Pruebas de carga de API

En la pantalla **Carga controlada**, usa **Importar colección de Postman** para leer un JSON v2.0 o v2.1 en el navegador. Selecciona un endpoint GET para completar la URL con el entorno autorizado y revisa el perfil antes de encolar. Puedes escribir la URL manualmente. La importación usa la ruta de cada solicitud y omite sus credenciales, scripts y valores de consulta. Las solicitudes que declaran autenticación, métodos distintos de GET o rutas por completar se informan en la vista previa.

## API de onboarding

| Método | Ruta | Comportamiento |
| --- | --- | --- |
| GET | `/api/projects` | Lista proyectos con sus entornos. |
| GET | `/api/projects/:id` | Devuelve la configuración y los requisitos pendientes. Responde `404` para un UUID inexistente. |
| POST | `/api/projects` | Crea un borrador por defecto. Con `status: "READY"` valida que el registro esté completo antes de crearlo. |
| PUT | `/api/projects/:id` | Guarda la configuración completa del proyecto. Exige la revisión actual y devuelve `409` ante una revisión obsoleta o un proyecto archivado. |

Prueba las cuatro rutas desde PowerShell:

```powershell
$api = 'http://127.0.0.1:3001/api/projects'
$draft = Invoke-RestMethod -Uri $api -Method Post -ContentType 'application/json' `
  -Body (@{ name = 'Portal de prueba' } | ConvertTo-Json)

$config = @{
  revision = $draft.revision
  status = 'READY'
  name = $draft.name
  ownerLabel = 'Equipo QA'
  priorityModules = @('Catálogo')
  environments = @(@{
    type = 'QA'
    baseUrl = 'https://qa.example.com/catalogo'
    accessMode = 'PRIVATE'
    authorizationConfirmed = $true
    readOnly = $true
    allowedHosts = @('qa.example.com')
    allowedPaths = @(@{ host = 'qa.example.com'; path = '/catalogo' })
    excludedPaths = @(@{ host = 'qa.example.com'; path = '/catalogo/pagos' })
    prohibitedActions = @('Comprar', 'Borrar')
    testData = @{
      syntheticData = 'Catálogo ficticio'
      seeds = 'Carga inicial de QA'
      cleanupStrategy = 'Restaurar datos semilla'
      integrations = @('Pasarela simulada')
    }
  })
  roles = @(@{
    name = 'Lector'
    secretReference = 'vault:qa/lector'
    permissions = @(
      @{ resource = 'Catálogo'; action = 'Ver'; allowed = $true }
      @{ resource = 'Catálogo'; action = 'Borrar'; allowed = $false }
    )
  })
  executionSettings = @{
    browser = 'CHROMIUM'
    frequency = 'Semanal'
    maxPages = 10
    maxDurationSeconds = 30
    maxConcurrency = 1
    requestsPerMinute = 20
    notifications = 'Equipo QA'
  }
}
$projectUri = "$api/$($draft.id)"
Invoke-RestMethod -Uri $projectUri -Method Put -ContentType 'application/json' `
  -Body ($config | ConvertTo-Json -Depth 10)
Invoke-RestMethod -Uri $projectUri | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri $api
```

El `PUT` sustituye la configuración de onboarding en una sola escritura. Envía los ID de los entornos existentes para conservarlos. Los entornos omitidos se quitan, los que llegan sin ID se crean y los roles conservan su identidad mientras mantienen el nombre. Envía `authorizationConfirmed: true` por entorno cuando confirmes la autorización para la configuración enviada. Si cambia la URL, el acceso o las restricciones, esa confirmación registra una fecha nueva. El formato básico anterior con `baseUrl`, `environment`, `authorizationConfirmed` y `readOnly` sigue disponible para crear borradores.

La API valida el propietario declarado, el tipo y modo de acceso, HTTPS, la confirmación y el alcance explícito por entorno para `READY`. Las rutas se aplican por dominio exacto y prefijo de segmentos. Por ejemplo, `/catalogo` incluye `/catalogo/producto`, mientras que `/catalogos` requiere su propia regla. La ruta `/` abarca todo el dominio cuando se declara explícitamente. Las exclusiones tienen prioridad. Usa dominios sin IP ni comodines y rutas absolutas sin codificación porcentual ni segmentos ambiguos. Las URLs base deben omitir credenciales, consultas, fragmentos y puertos personalizados. La API limita cada cuerpo JSON a 100 KiB.

## Migraciones y pruebas automatizadas

La migración inicial reproduce el esquema base con los enums válidos. La migración de onboarding agrega configuración, permisos y autorización por entorno. Conserva los datos existentes, copia la autorización histórica a su único entorno cuando corresponde y vuelve a borrador los registros previos con estado `READY` para que completen el alcance. Si Prisma reporta `P3005` en una base creada manualmente, compara su esquema con [la migración inicial](prisma/migrations/20261114000000_init/migration.sql). Solo si coinciden, registra esa migración con `npx.cmd prisma migrate resolve --applied 20261114000000_init` antes de aplicar las pendientes.

En una terminal de pruebas independiente, crea una base separada y aplica las migraciones. El comando `createdb` es necesario una vez:

```powershell
docker compose exec -T postgres createdb -U autoqa autoqa_test
$env:AUTOQA_TEST_DATABASE_URL = 'postgresql://autoqa:autoqa_local_only@127.0.0.1:5432/autoqa_test?schema=public'
$env:DATABASE_URL = $env:AUTOQA_TEST_DATABASE_URL
npm.cmd run db:deploy
npm.cmd run test:onboarding
```

La suite inicia NestJS en un puerto local, usa Prisma y PostgreSQL reales y elimina los proyectos sintéticos que crea. Cubre persistencia, estados, autorización, alcance, roles, restricciones y ediciones concurrentes. Para inspeccionar la base de desarrollo, abre otra terminal en la raíz y ejecuta `npx.cmd prisma studio`.

### Generación incremental desde el análisis documental

En **Escenarios**, «Generar casos de prueba» muestra los tipos con documentos nuevos, versiones nuevas o aclaraciones aprobadas pendientes de generar. Cada agente recibe los requisitos verificables de la documentación pendiente de su tipo. Al agregar un documento exclusivo para Performance, los tipos ya generados con sus versiones previas conservan su cobertura. La generación web, móvil y manual conserva el vínculo con el requisito verificable y prioriza requisitos sin escenarios del tipo solicitado. Escenarios muestra el número de casos guardados y actualiza la lista al terminar. La primera generación de cada proyecto intenta todos los tipos confirmados. Si una respuesta de IA llega incompleta o con un formato inválido, el agente vuelve a pedir una respuesta más breve antes de guardar casos. AutoQA guarda los casos del lote en una sola transacción cuando cada tipo confirmado tiene un caso válido. Si a un tipo le faltan casos, el intento informa el motivo y deja el lote completo pendiente. En hojas de cálculo, Móvil emulado y Casos manuales priorizan las historias cuya columna Categoría o Tipo de prueba corresponda a cada agente.

En **Datos**, abre «Ambiguos o pendientes», selecciona un requisito e introduce la corrección o adjunta un TXT/Markdown con su texto. Añade un criterio observable y aprueba la aclaración. El IPA se recalcula sin procesar de nuevo el documento; el hallazgo conserva el texto, la versión y la ubicación originales. Si ya había escenarios vinculados, revísalos y confirma su cobertura desde el editor. Los resultados anteriores permanecen asociados al escenario.

Para publicar esta función, aplica la migración `20261122120000_requirement_clarification` y compila la API, la web y Explorer con el cliente Prisma regenerado. Si una generación termina con `review-missing`, comprueba la versión del proceso que consume la cola. Desde el flujo incremental, la solicitud usa el análisis documental persistido. Una versión anterior de Explorer espera el resultado del revisor dentro del trabajo. El aviso de Escenarios incluye una referencia del trabajo para consultar `AutomationJob.errorCode`.

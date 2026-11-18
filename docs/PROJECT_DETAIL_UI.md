# Detalle de proyecto

La ruta `/projects/[id]` conserva Next.js, las consultas autenticadas de `accountFetch`, los proxies del mismo origen y los formularios existentes. El diseño toma como referencia la captura de Stitch proporcionada: fondo marfil, acento azul, tipografía monoespaciada en etiquetas, tarjetas numeradas y panel lateral de preparación. No requiere migraciones ni nuevos paquetes.

## Componentes y datos

- `app-shell.tsx`, `app-nav.tsx` y `style.css`: cabecera compartida de la zona autenticada, fuera de los márgenes del contenido. Conserva enlaces y cierre de sesión; muestra organización incluso cuando coincide con el nombre del usuario, pasa solamente el nombre del plan desde el servidor y usa icono azul para la cuenta. El menú muestra identidad y suscripción, admite teclado, Escape y cierre al pulsar fuera. En móvil usa navegación desplegable y trunca nombres largos. La portada comercial y los formularios públicos mantienen su contenedor.

- `project-heading.tsx`: breadcrumb, estado, revisión, nombre, descripción y acciones. La exportación JSON proyecta explícitamente los campos de alcance y permisos; omite URL base, usuarios, credenciales y referencias de secretos. No es un respaldo completo ni permite reimportación.
- `project-tabs.tsx`: conserva las seis pestañas, hash compartible y visibilidad de Exploración según el plan. Añade relaciones ARIA y navegación con flechas, Inicio y Fin. El CTA de automatización navega a la pestaña, sin iniciar ejecuciones.
- `data-tab.tsx`: resumen del registro completo, selector local de entorno, documentación consultada mediante el proxy existente, matriz de permisos, IPA y diagnóstico. Modificar o adjuntar lleva a `ProjectForm`, enfocando la sección correspondiente. El resultado del guardado actualiza el resumen y se conserva `router.refresh()`.
- `ipa-hero.tsx`: reutiliza el score, nivel y criterios reales. La dona del resumen representa el porcentaje recibido. Si falla la consulta no muestra un score ficticio.
- `project-detail.css`: estilos limitados a la vista del proyecto. A partir de 760 px se usa una columna; las pestañas permiten desplazamiento horizontal en pantallas estrechas.

Los documentos diferencian declarado, cargado, procesado y validado. Un error de consulta permite reintentar y se distingue de una lista vacía. No se copian del mockup puntajes, nombres, expiraciones JWT ni mensajes de ejecución. El panel oscuro refleja autorizaciones, documentos y evaluación del registro; no es telemetría en vivo ni evidencia de pruebas ejecutadas.

## Verificación

En PowerShell desde la raíz: `npm.cmd run test:project-detail`. La suite usa Google Chrome headless y una API HTTP simulada en loopback, con datos sintéticos y puertos temporales; cierra sus procesos al finalizar. Verifica resoluciones de 1440, 768, 390 y 320 px, disposición de columnas, estados documentales, selección de entornos, copiar URL, descarga sin secretos, pestañas/teclado, selección y eliminación de archivos pendientes, guardado a través del formulario/proxy, acceso a roles, error/reintento, ausencia de IPA, visibilidad por plan y borradores. Revisa errores JavaScript y captura escritorio/móvil.

La prueba es de interfaz. No sustituye `test:onboarding`, `test:documents` ni las pruebas de los motores. Para comprobar persistencia manualmente con la API real, editar el propietario, completar el registro y recargar; adjuntar un documento mediante el formulario existente y volver al resumen. Las credenciales y permisos de la instalación siguen siendo necesarios. Las capturas de la suite son demostraciones con datos sintéticos.

La misma suite comprueba cabecera sin márgenes, organización/plan recibidos, organización igual al nombre del usuario, ausencia de plan, nombres largos a 320 px, menú móvil, apertura de cuenta con teclado, Escape, clic exterior y llamada al endpoint de cierre de sesión. Además de las capturas del detalle genera `app-navigation-desktop.png` y `app-navigation-reference-width.png` (1155 px, para comparar con la referencia).

## Pestaña Escenarios

La vista `/projects/[id]#escenarios` usa lista/detalle, búsqueda, etiquetas y selección múltiple. `ScenariosPanel` conserva creación, sugerencias y generación existentes; `ScenarioWorkspace` presenta los datos y reutiliza `ScenarioCard` al editar. `ProjectTabs` proporciona un destino de cabecera mediante contexto; la cabecera de escenarios se monta allí con un portal para mantener el orden visual y de teclado (cabecera, pestañas, filtros, lista y detalle). Las otras pestañas conservan su cabecera. El contador procede de la lista recibida.

El endpoint existente de escenarios aporta pasos, etiquetas y requisito; el historial `/runs` aporta fechas, estados y duraciones. Se toma la ejecución más reciente por fecha. En cola, en curso, fallo, bloqueo, omisiones, ausencia de resultados y error de consulta se muestran separadamente. No se inventa un archivo Playwright persistido, fuente documental, cobertura o worker activo. Los filtros usan presencia de resultados, porque la API no expone una clasificación persistida de «automatizado» frente a «borrador».

`scenario-presentation.ts` deriva una representación BDD de las acciones guardadas, reutilizando la heurística de palabras clave existente. `Exportar feature` exporta los seleccionados o todos si no hay selección, añade IDs y requisitos disponibles y declara que las palabras clave son inferidas. No añade resultados esperados ausentes ni constituye validación de una suite ejecutable. Los valores de pasos se conservan como datos.

`ScenarioRunDialog` exige confirmación y limita el selector a entornos autorizados de solo lectura del proyecto READY. Reutiliza `POST /projects/:projectId/scenarios/:scenarioId/runs` para cada caso elegido. La API sigue siendo la autoridad de pertenencia, permisos, plan, cuota y alcance. Abrir, consultar, exportar o cancelar no envía trabajos. Los rechazos se muestran por escenario; ante fallo de red se indica que no hay confirmación y se pide consultar el reporte antes de reintentar. No se ejecuta ninguna prueba durante la validación de interfaz.

La prueba de navegador cubre filtros combinados, búsqueda y atajo, selección visible y selección total conservada, exportación de casos seleccionados, detalles sin resultado esperado, creación, edición con tags de flujo mutuamente excluyentes, confirmación/cancelación, petición al proxy y rechazo de cuota simulado, reintento de lista e historial, lista vacía, bloqueo para borradores o entornos sin autorización y disposición móvil. Guarda `project-scenarios-desktop.png` y `project-scenarios-mobile.png`, con datos sintéticos. No requiere migraciones ni nuevos paquetes; utiliza la dependencia Playwright ya instalada.

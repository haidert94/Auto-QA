# Detalle de proyecto

La ruta `/projects/[id]` conserva Next.js, las consultas autenticadas de `accountFetch`, los proxies del mismo origen y los formularios existentes. El diseño toma como referencia la captura de Stitch proporcionada: fondo marfil, acento azul, tipografía monoespaciada en etiquetas, tarjetas numeradas y panel lateral de preparación. No requiere migraciones ni nuevos paquetes.

## Componentes y datos

- `project-heading.tsx`: breadcrumb, estado, revisión, nombre, descripción y acciones. La exportación JSON proyecta explícitamente los campos de alcance y permisos; omite URL base, usuarios, credenciales y referencias de secretos. No es un respaldo completo ni permite reimportación.
- `project-tabs.tsx`: conserva las seis pestañas, hash compartible y visibilidad de Exploración según el plan. Añade relaciones ARIA y navegación con flechas, Inicio y Fin. El CTA de automatización navega a la pestaña, sin iniciar ejecuciones.
- `data-tab.tsx`: resumen del registro completo, selector local de entorno, documentación consultada mediante el proxy existente, matriz de permisos, IPA y diagnóstico. Modificar o adjuntar lleva a `ProjectForm`, enfocando la sección correspondiente. El resultado del guardado actualiza el resumen y se conserva `router.refresh()`.
- `ipa-hero.tsx`: reutiliza el score, nivel y criterios reales. La dona del resumen representa el porcentaje recibido. Si falla la consulta no muestra un score ficticio.
- `project-detail.css`: estilos limitados a la vista del proyecto. A partir de 760 px se usa una columna; las pestañas permiten desplazamiento horizontal en pantallas estrechas.

Los documentos diferencian declarado, cargado, procesado y validado. Un error de consulta permite reintentar y se distingue de una lista vacía. No se copian del mockup puntajes, nombres, expiraciones JWT ni mensajes de ejecución. El panel oscuro refleja autorizaciones, documentos y evaluación del registro; no es telemetría en vivo ni evidencia de pruebas ejecutadas.

## Verificación

En PowerShell desde la raíz: `npm.cmd run test:project-detail`. La suite usa Google Chrome headless y una API HTTP simulada en loopback, con datos sintéticos y puertos temporales; cierra sus procesos al finalizar. Verifica resoluciones de 1440, 768, 390 y 320 px, disposición de columnas, estados documentales, selección de entornos, copiar URL, descarga sin secretos, pestañas/teclado, selección y eliminación de archivos pendientes, guardado a través del formulario/proxy, acceso a roles, error/reintento, ausencia de IPA, visibilidad por plan y borradores. Revisa errores JavaScript y captura escritorio/móvil.

La prueba es de interfaz. No sustituye `test:onboarding`, `test:documents` ni las pruebas de los motores. Para comprobar persistencia manualmente con la API real, editar el propietario, completar el registro y recargar; adjuntar un documento mediante el formulario existente y volver al resumen. Las credenciales y permisos de la instalación siguen siendo necesarios. Las capturas de la suite son demostraciones con datos sintéticos.

# Requisitos funcionales y no funcionales
## Onboarding
RF-01 Registrar proyecto, URL HTTPS, entorno, propietario/tenant y autorización expresa.
RF-02 Definir dominios/rutas permitidos, módulos prioritarios, exclusiones y acciones prohibidas.
RF-03 Indicar aplicación pública/privada/SSO; configurar roles, matriz de permisos y cuentas de prueba por mecanismo seguro (no contraseñas en BD de proyectos).
RF-04 Declarar datos sintéticos/semillas, estrategia de limpieza, integraciones y entornos de prueba.
RF-05 Configurar navegador, frecuencia, límites y notificaciones.
RF-06 Permitir guardar borradores e identificar requisitos obligatorios para iniciar ejecución.

## Documentación
RF-07 Cargar PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, YAML y YML, incluidas especificaciones OpenAPI; más adelante conectar Jira/Azure DevOps.
RF-08 Extraer historias de usuario, requisitos, criterios de aceptación, reglas de negocio, referencias y versiones.
RF-09 Marcar ambigüedades, contradicciones y ausencia de resultados esperados; solicitar aclaraciones. No inventar criterios.
RF-10 Mantener trazabilidad requisito -> escenario -> prueba -> ejecución -> evidencia.

## Automatización
RF-11 Explorar exclusivamente objetivos autorizados, con límites de páginas, tiempo, concurrencia y tasa.
RF-12 Inventariar páginas, formularios, rutas y flujos observados por rol.
RF-13 Generar pruebas Playwright TypeScript con aserciones significativas, revisables y persistentes.
RF-14 Ejecutar en workers aislados; capturar logs saneados, screenshots y traces con retención configurada.
RF-15 Detectar cambios y regenerar solo pruebas afectadas; diferenciar fallos de producto, test, entorno y bloqueos.
RF-16 Producir reporte con éxito/fallo/bloqueo, evidencia, cobertura verificable y recomendaciones.

## Calidad
RF-17 Calcular IPA antes de ejecutar y ICSP después, con denominadores y justificación verificables.
RF-18 Mostrar requisitos no probados y escenarios bloqueados separadamente.

## No funcionales
RNF-01 Seguridad: aislamiento por tenant, autenticación, autorización, auditoría, cifrado, secretos externos, protección SSRF y sandbox de workers.
RNF-02 Observabilidad: métricas de costo IA, duración, errores, reintentos y cola.
RNF-03 Portabilidad: Docker y configuración por entorno, Windows local y posterior nube.
RNF-04 Idempotencia de jobs, límites de recursos, cancelación y retención de evidencias.
RNF-05 Privacidad: minimización de datos enviados a IA externa, redacción de PII y políticas de retención.

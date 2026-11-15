# Roadmap incremental para Codex
0. Auditar starter: instalar, compilar, validar Prisma y endpoints, añadir tests básicos. No declarar éxito sin ejecución.
1. Onboarding completo: URL, entorno, autorización, alcance, modos de acceso, roles declarados, prioridades, restricciones y borradores. Criterios: validación backend, persistencia, endpoints y pruebas.
2. Seguridad base: autenticación, organizaciones/tenants, permisos, auditoría y protección de datos.
3. Documentos: subida controlada, almacenamiento, parsing, requisitos, criterios, ambigüedades y preguntas.
4. IPA: cálculo explicable, evidencia, bloqueos, historial de evaluaciones.
5. Exploración Playwright: workers aislados, allowlists, protección SSRF, límites y modo lectura.
6. Escenarios y ejecución: generación Playwright TypeScript, aserciones, almacenamiento, colas, resultados y traces.
7. ICSP: cobertura real, estabilidad, trazabilidad, reportes y exportación.
8. Optimización: tests persistentes, diff, caché, enrutamiento IA híbrida, presupuestos internos.
9. Comercial: facturación, planes y cuotas de capacidad, despliegue seguro, monitoreo.

La entrega local disponible incluye onboarding, documentación e IPA. La clave documental protege la API local mientras se desarrolla la seguridad por usuario y tenant.

## Definición de terminado por entrega
Código revisable; migración reproducible; pruebas automatizadas relevantes; controles de seguridad para el alcance; documentación y comandos de ejecución; limitaciones explícitas.

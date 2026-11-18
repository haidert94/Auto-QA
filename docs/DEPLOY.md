# Despliegue en Hostinger

Estado actual del despliegue en `yanballilibeth.com`. Las restricciones del runtime y las decisiones del entry file están explicadas en los comentarios de [`server.js`](../server.js).

## Topología

Un único proceso Node en Hostinger (Node.js hosting, `app_type: express`) que corre `server.js`. Ese archivo:

1. Monta NestJS (`apps/api/dist/app.js`) como handler Express **sin llamar a `listen`**.
2. Monta Next.js (`apps/web`) como handler principal en el mismo `http.Server`.
3. Rutea todo a Next.js. Los route handlers de Next en `apps/web/app/api/*` son los únicos que envuelven la sesión en la cookie `autoqa_session`.
4. Los route handlers de Next llaman a NestJS vía `accountFetch` → parche de `globalThis.fetch` → handler Express en proceso.

Hay un solo `server.listen()` por restricción de Hostinger (un segundo `listen` se ignora silenciosamente). Las migraciones de Prisma corren en el build, no en runtime, porque Hostinger mata el proceso si tarda más de 3 segundos en llamar a `listen`.

## Datos del despliegue

| Dato | Valor |
| --- | --- |
| Dominio | `yanballilibeth.com` |
| Hosting | Hostinger Node.js (compartido) |
| Entry file | `server.js` |
| Build script | `npm run build` (incluye `prisma generate && npm run db:deploy && build api && build web`) |
| Base de datos | Neon Postgres (`DATABASE_URL` configurada en hPanel) |
| Auto-deploy | GitHub `haidert94/Auto-QA`, branch `main` |

Cada push a `main` dispara el build. Cambiar una env var se hace en hPanel → Node.js → Variables de entorno (el endpoint `replace-environment-variables` reemplaza TODO el set).

## Variables de entorno obligatorias

| Variable | Valor |
| --- | --- |
| `AUTOQA_DEPLOYMENT` | `hosted` |
| `DATABASE_URL` | cadena de Neon Postgres |
| `DIRECT_URL` (opcional) | conexión directa a la misma base/esquema para migraciones; sin `-pooler`. Alternativa: `DATABASE_URL_UNPOOLED` |
| `WEB_ORIGIN` / `AUTOQA_ACCOUNT_ORIGIN` | `https://yanballilibeth.com` |
| `AUTOQA_DOCUMENTS_TOKEN` | clave de 64 hex, generada según [docs/DOCUMENTS.md](DOCUMENTS.md) |
| `AUTOQA_MAIL_MODE` | `smtp` |
| `AUTOQA_SMTP_HOST`, `AUTOQA_SMTP_PORT`, `AUTOQA_MAIL_FROM`, `AUTOQA_SMTP_USER`, `AUTOQA_SMTP_PASS` | credenciales Resend (dominio `yanballilibeth.com` verificado) |
| `AUTOQA_ADMIN_TOKEN` | 64 hex, protege la activación manual (ver abajo) |
| `AUTOQA_SECRET_KEY` | 64 hex (o 32 bytes base64), cifra credenciales de entorno (ver abajo) |

Opcionales: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` para activar el `AiRouter`; sin ellas se cae al `RuleBasedProvider` y los agentes de generación de escenarios funcionan con resultados mínimos.

## Conexión directa y bloqueos de migraciones (P1002)

El error `Timed out trying to acquire a postgres advisory lock (SELECT pg_advisory_lock(72707369))` ocurre en `migrate deploy`, antes de compilar NestJS y Next.js. No es un fallo de estilos. El log del build fallido mostraba una conexión Neon con `-pooler`; eso es un hecho observado. Neon no admite bloqueos de sesión en conexiones agrupadas, y Prisma Migrate necesita ese mecanismo. Otro proceso también puede retener el bloqueo; el log por sí solo no identifica qué sesión lo tiene. Referencias: [pooling de Neon](https://neon.com/docs/connect/connection-pooling), [bloqueos de Prisma 6](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production#advisory-locking).

`scripts/prisma-migrate-deploy.cjs` ejecuta la CLI Prisma instalada, sin shell ni instalaciones adicionales, con este orden:

1. `DIRECT_URL`, si está definida y no está vacía.
2. `DATABASE_URL_UNPOOLED`, si está definida y no está vacía.
3. Si `DATABASE_URL` tiene un host Neon `ep-…-pooler.…neon.tech`, usa ese mismo host sin `-pooler` **solo en el proceso hijo de migraciones**. Conserva usuario, contraseña codificada, base, esquema y parámetros TLS. Quita `pgbouncer` en la conexión directa.
4. En otros PostgreSQL usa `DATABASE_URL` sin adivinar otro host.

Las conexiones directas explícitas deben apuntar a la misma base y esquema; en Neon se comprueba también el endpoint. No se añade `directUrl` obligatorio al esquema, por lo que la configuración local existente sigue siendo válida. La conexión de Prisma Client durante la ejecución de la app no cambia. El script carga `.env` de la raíz, dando prioridad al entorno del proceso, y omite URLs y contraseñas en sus mensajes.

Para Hostinger puedes mantener `npm run build` como comando de compilación: la derivación Neon funciona sin añadir variables. Se recomienda configurar explícitamente `DIRECT_URL` desde **Neon → Connect**, desactivando **Connection pooling**, copiando la cadena privada a hPanel para la misma base y conservando TLS. No publiques esa cadena ni la pegues en Git. Mantén `DATABASE_URL` con pooling para la aplicación.

Solo un `P1002` que identifica el advisory lock se reintenta, hasta tres intentos con pausas de 2 y 4 segundos. Prisma conserva su espera interna de 10 segundos por intento. Fallos SQL, migraciones fallidas o errores de conexión no se ocultan ni se reintentan indiscriminadamente. Si el bloqueo persiste se devuelve un estado no exitoso y se detiene el build. No se configura `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`, no se resetea la base ni se marca ninguna migración como aplicada.

Después de subir la corrección, comprueba que hPanel construye ese commit. Espera a que terminen o cancela desde hPanel los builds duplicados antes de reintentar. Si aún falla con P1002 usando conexión directa, un administrador puede inspeccionar el bloqueo desde el SQL Editor de Neon con esta consulta de solo lectura:

```sql
SELECT a.pid, a.application_name, a.state, a.query_start, l.granted,
       pg_blocking_pids(a.pid) AS blocking_pids
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory'
  AND l.classid = 0 AND l.objid = 72707369 AND l.objsubid = 1;
```

No termines sesiones ni reinicies la base sin identificar al propietario del trabajo y su impacto. Si aparece `P3009` u otro error SQL, revisa esa migración antes de continuar; no se resuelve desactivando bloqueos.

Para repetir las pruebas en Windows: `npm.cmd run test:deploy`. Son pruebas sin red del selector de conexión, redacción, reintentos y propagación de errores. La validación adicional del cambio reprodujo P1002 en un PostgreSQL local temporal, liberó exclusivamente el bloqueo creado por la prueba, aplicó las 26 migraciones y ejecutó el build completo. Esa prueba no acredita el estado de los locks ni el éxito del siguiente despliegue en Neon/Hostinger; hay que comprobar su log.

## Clave de cifrado de credenciales (`AUTOQA_SECRET_KEY`)

Cuando un entorno declara acceso `PRIVATE` o `SSO`, el wizard permite capturar usuario y contraseña de una cuenta de prueba. El servidor los cifra con AES-256-GCM antes de guardarlos en Postgres; la contraseña nunca vuelve al cliente y nunca se escribe en logs (`validationError.value: false` en `app.ts`, Prisma sin query logging, logger Nest en `['error','warn']`).

Generar la clave:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Esa cadena de 64 hex chars va a `AUTOQA_SECRET_KEY` en hPanel → Node.js → Variables de entorno. Si no está configurada, la API rechaza guardar credenciales con 500 explícito en vez de persistirlas en claro.

**Implicaciones de pérdida**: si la clave se pierde o se rota sin migrar los cipherblobs, todas las contraseñas guardadas quedan irrecuperables. El wizard vuelve a mostrar los campos vacíos con `hasCredentials: false` y el cliente tiene que volver a tipearlas. No hay flujo de recuperación; es una decisión de diseño, no un bug.

**Rotación segura**:
1. Genera `AUTOQA_SECRET_KEY_NEW` paralela.
2. Script ad-hoc: para cada `Environment.credentialCipher`, descifrar con la vieja, cifrar con la nueva, actualizar.
3. Reemplazar `AUTOQA_SECRET_KEY` con la nueva en hPanel.
4. Rebuild.

Ese script aún no existe; cuando se vaya a rotar por primera vez hay que escribirlo (es un for-loop sobre `prisma.environment.findMany` + `secretCipher.decrypt` + nuevo cipher + `update`).

**Borrado de credenciales por el cliente**: el detalle de proyecto tiene un botón "Borrar credencial guardada" dentro del fieldset "Credenciales de la cuenta de prueba". Marca `credentials: null` en el payload; el service borra `credentialUser` y `credentialCipher` al guardar.

## Activación manual de suscripciones

En producción no hay pasarela conectada todavía. Las suscripciones quedan `PENDING` tras el registro. Para activarlas:

- **Página web:** [`https://yanballilibeth.com/admin/activar`](../apps/web/app/admin/activar/page.tsx). Pide el token, email, plan y días. El token no se guarda en el navegador.
- **API directa** (útil desde terminal):

```powershell
curl -X POST "https://yanballilibeth.com/api/commerce/admin/activate" `
  -H "Content-Type: application/json" `
  -H "X-Admin-Token: <token>" `
  -d '{"email":"usuaria@ejemplo.com","plan":"professional","days":365}'
```

`plan` acepta los códigos habilitados en el catálogo (`essentials`, `professional`, `business`, `enterprise` al 2026-11-17). `days` va de 1 a 365, por defecto 30 en el backend. Si `AUTOQA_ADMIN_TOKEN` no está configurado el endpoint responde 503; si no match, 403.

Para rotar el token: genéralo con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` y reemplázalo en hPanel. Las suscripciones ya activadas siguen activas; solo se bloquean nuevas activaciones.

## Lo que no está desplegado

- **Worker Explorer** (`apps/explorer`). Necesita Playwright/Chromium, Lighthouse y k6; no cabe en el hosting compartido. Debe correr en una VPS apuntando a la misma `DATABASE_URL`. Sin esto no se ejecutan runs reales. Ver [EXPLORER_DEPLOY.md](EXPLORER_DEPLOY.md).
- **Almacenamiento persistente de documentos** (`AUTOQA_DOCUMENTS_DIR`). No está confirmado que Hostinger preserve ese directorio entre deploys; evaluar S3 (`@aws-sdk/client-s3` ya está en dependencies) para producción.
- **Pasarela de pago real.** El botón de contratación solo funciona en modo sandbox local; en producción se activa con `/admin/activar`.

## Operaciones y diagnóstico

- Logs runtime: op MCP `hosting_nodejs_runtime-logs` (`period: 1h` o `1d`), o hPanel.
- Estado del último build: `hosting_get-deployment` o hPanel.
- Variables (solo claves, valores enmascarados): `hosting_nodejs_list-environment-variables`.
- `replace-environment-variables` reemplaza TODO el set: para cambiar una sola variable sin riesgo de borrar las demás, editarla en hPanel.

## Notas antes de agregar algo al runtime

Antes de modificar `server.js` o cualquier cosa que corra en Hostinger, verifica que:

1. No añade un segundo `listen`.
2. No bloquea más de ~1s antes del bind (Prisma, descargas, hashing de datos grandes → al build).
3. No asume loopback HTTP TCP a sí mismo (está bloqueado).
4. Sus dependencias están en `dependencies`, no `devDependencies` (estas últimas se descartan en runtime).
5. Si expone un nuevo endpoint externo de NestJS, tiene un Next route proxy en `apps/web/app/api/<path>/route.ts`.
6. Si toca el parche de fetch, sigue drenando streams de `init.body` y leyendo `res.statusCode` del propio objeto.

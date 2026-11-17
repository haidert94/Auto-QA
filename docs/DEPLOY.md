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
| Build script | `npm run build` (incluye `prisma generate && prisma migrate deploy && build api && build web`) |
| Base de datos | Neon Postgres (`DATABASE_URL` configurada en hPanel) |
| Auto-deploy | GitHub `haidert94/Auto-QA`, branch `main` |

Cada push a `main` dispara el build. Cambiar una env var se hace en hPanel → Node.js → Variables de entorno (el endpoint `replace-environment-variables` reemplaza TODO el set).

## Variables de entorno obligatorias

| Variable | Valor |
| --- | --- |
| `AUTOQA_DEPLOYMENT` | `hosted` |
| `DATABASE_URL` | cadena de Neon Postgres |
| `WEB_ORIGIN` / `AUTOQA_ACCOUNT_ORIGIN` | `https://yanballilibeth.com` |
| `AUTOQA_DOCUMENTS_TOKEN` | clave de 64 hex, generada según [docs/DOCUMENTS.md](DOCUMENTS.md) |
| `AUTOQA_MAIL_MODE` | `smtp` |
| `AUTOQA_SMTP_HOST`, `AUTOQA_SMTP_PORT`, `AUTOQA_MAIL_FROM`, `AUTOQA_SMTP_USER`, `AUTOQA_SMTP_PASS` | credenciales Resend (dominio `yanballilibeth.com` verificado) |
| `AUTOQA_ADMIN_TOKEN` | 64 hex, protege la activación manual (ver abajo) |

Opcionales: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` para activar el `AiRouter`; sin ellas se cae al `RuleBasedProvider` y los agentes de generación de escenarios funcionan con resultados mínimos.

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

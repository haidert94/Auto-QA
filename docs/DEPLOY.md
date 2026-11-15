# Despliegue en un PaaS (demo privada)

Estado: **no probado**. La imagen no se ha construido ni ejecutado todavía.

## Topología

Un solo servicio (el `Dockerfile` de la raíz) ejecuta `scripts/start-hosted.mjs`:

1. `prisma migrate deploy` contra `DATABASE_URL`.
2. La API NestJS escucha en `127.0.0.1:3001` y no se expone.
3. Next.js escucha en `0.0.0.0:$PORT` y reenvía a la API por loopback.

Se usa un solo servicio porque `AUTOQA_INTERNAL_API_URL` solo admite `http` en localhost o `https` en otro host.

## Recursos necesarios

- PostgreSQL gestionado (`DATABASE_URL`).
- Un volumen persistente montado en `/data` (`AUTOQA_DOCUMENTS_DIR=/data/documents`). Sin volumen se pierden los documentos en cada despliegue.
- Un proveedor SMTP real (en modo `hosted` Mailpit queda deshabilitado).
- Un subdominio con HTTPS apuntando al servicio.

## Variables de entorno

| Variable | Valor |
| --- | --- |
| `AUTOQA_DEPLOYMENT` | `hosted` |
| `DATABASE_URL` | cadena del PostgreSQL gestionado |
| `WEB_ORIGIN` / `AUTOQA_ACCOUNT_ORIGIN` | `https://<subdominio>` |
| `AUTOQA_DOCUMENTS_TOKEN` | clave aleatoria generada según `docs/DOCUMENTS.md` |
| `AUTOQA_DOCUMENTS_DIR` | `/data/documents` |
| `AUTOQA_MAIL_MODE` | `smtp` |
| `AUTOQA_SMTP_HOST`, `AUTOQA_SMTP_PORT`, `AUTOQA_MAIL_FROM`, `AUTOQA_SMTP_USER`, `AUTOQA_SMTP_PASS` | del proveedor SMTP |

No subas `.env` a Git ni a la imagen (está en `.gitignore` y `.dockerignore`). Configura los secretos en el panel del PaaS.

## Activación manual de suscripciones

Con `AUTOQA_DEPLOYMENT=hosted` los cobros simulados quedan deshabilitados y no existe aún un proveedor de pagos real. Para la demo hay un endpoint de activación manual, protegido por `AUTOQA_ADMIN_TOKEN` (64 hex). Genera el token con:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cópialo a `AUTOQA_ADMIN_TOKEN` en las variables del PaaS y guárdalo donde solo tú lo veas. Si el valor no está configurado, el endpoint responde `503` y no deja activar nada. Para activar una cuenta registrada y verificada:

```powershell
curl -X POST "https://<subdominio>/api/commerce/admin/activate" `
  -H "Content-Type: application/json" `
  -H "X-Admin-Token: <token>" `
  -d '{"email":"usuaria@ejemplo.com","plan":"starter","days":30}'
```

`plan` acepta `starter`, `pro` o `business`. `days` es opcional y por defecto 30 (máximo 365). La respuesta incluye el estado y la fecha de vencimiento. Si el token cambia, las cuentas ya activadas siguen activas; solo se bloquean nuevas activaciones.

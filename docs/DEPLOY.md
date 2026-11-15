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

## Limitación conocida

Con `AUTOQA_DEPLOYMENT=hosted` los cobros simulados quedan deshabilitados y no existe aún un proveedor de pagos real. Una cuenta puede registrarse y verificar su correo, pero no activar una suscripción. Hay que decidir cómo habilitar la demo (por ejemplo, activar suscripciones manualmente en la base de datos) antes de compartirla.

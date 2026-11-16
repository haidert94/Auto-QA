# Despliegue del worker de exploración (Fase 5.8)

Guía para dejar el worker de Playwright corriendo en un VPS Linux.
Pensada para Ubuntu 22.04 LTS o 24.04 LTS.

## Qué estamos desplegando

El worker:
- Lee la cola `Exploration` en PostgreSQL (misma base que usa la API).
- Toma una fila `QUEUED` con `FOR UPDATE SKIP LOCKED`, la pasa a `RUNNING`.
- Lanza Chromium aislado (`chromiumSandbox: true`), aplica `url-guard` + filtro
  de requests, visita hasta `maxPages` URLs con BFS, guarda capturas en disco
  local y registra páginas y logs en PostgreSQL.
- Liquida el consumo (`MeteredRun.browserSeconds`) al terminar.

No expone HTTP. No necesita puerto público. Solo requiere salida a internet
(para los sitios que explora) y acceso a PostgreSQL.

## Requisitos mínimos del VPS

| Recurso | Mínimo | Recomendado |
|---|---|---|
| RAM | 2 GB | 4 GB |
| vCPU | 1 | 2 |
| Disco | 10 GB | 20 GB |
| SO | Ubuntu 22.04 | Ubuntu 24.04 |

Con 2 GB y 1 vCPU aguanta 1 exploración concurrente (que es lo que corre hoy:
`chromiumSandbox: true`, 1 navegador por tick). Para más concurrencia habrá
que subir límites y correr varios workers (iteración futura).

## Pasos

### 1. Preparar el VPS

```bash
ssh root@tu-vps
```

Actualizar y crear carpeta del repo:

```bash
apt-get update && apt-get -y upgrade
mkdir -p /opt
```

### 2. Clonar el repo

Opción A — HTTPS con token personal (lectura):

```bash
git clone https://<USUARIO>:<TOKEN>@github.com/<ORG>/autoqa-starter.git /opt/autoqa
```

Opción B — SSH (deploy key de solo lectura, recomendada para producción):

```bash
# en tu PC: generar un par solo para este VPS, subir la pública como deploy key
git clone git@github.com:<ORG>/autoqa-starter.git /opt/autoqa
```

No clones con una cuenta humana con permisos de escritura: el worker solo lee.

### 3. Correr el script de setup

```bash
cd /opt/autoqa
bash scripts/explorer-setup.sh
```

El script:
- Instala Node 22, dependencias nativas de Chromium y el propio Chromium.
- Crea el usuario `autoqa` (sin login) y los directorios
  `/var/lib/autoqa/explorations` y `/var/lib/autoqa/playwright-browsers`.
- Corre `npm ci` y compila `apps/explorer`.
- Avisa si el kernel tiene restringidos los *user namespaces* (Chromium los
  necesita para su sandbox).

Si avisa de `apparmor_restrict_unprivileged_userns=1` (Ubuntu 24.04):

```bash
echo 'kernel.apparmor_restrict_unprivileged_userns=0' > /etc/sysctl.d/98-autoqa-userns.conf
sysctl --system
```

### 4. Crear el archivo de entorno

Guárdalo fuera del repo, con permisos cerrados:

```bash
install -d -o root -g autoqa -m 0750 /etc/autoqa
touch /etc/autoqa/explorer.env
chown root:autoqa /etc/autoqa/explorer.env
chmod 0640 /etc/autoqa/explorer.env
```

Contenido mínimo (`/etc/autoqa/explorer.env`):

```ini
# Conexión a la MISMA base que usa la API.
# En producción con Neon: la URL con ?sslmode=require.
DATABASE_URL=postgresql://usuario:password@host:5432/autoqa?sslmode=require

# Opcional: donde guardar capturas. El script ya lo pone en el .service.
# AUTOQA_EXPLORATIONS_DIR=/var/lib/autoqa/explorations
```

Nunca metas este archivo en Git ni lo copies a /tmp.

### 5. Instalar la unidad systemd

```bash
install -m 0644 /opt/autoqa/scripts/explorer.service /etc/systemd/system/autoqa-explorer.service
systemctl daemon-reload
systemctl enable autoqa-explorer.service
systemctl start autoqa-explorer.service
```

Verificar:

```bash
systemctl status autoqa-explorer.service
journalctl -u autoqa-explorer.service -f
```

Lo esperado en journal con la cola vacía: silencio (el loop duerme 5 s entre
ticks). Con un trabajo encolado desde la UI, aparecen las entradas de
`exploration.log` en la base.

### 6. Comprobar end-to-end

1. En la UI de AutoQA, en un proyecto con plan que incluya `BROWSER_TESTS`,
   encolar una exploración de una URL dentro de `allowedHosts`.
2. `journalctl -u autoqa-explorer -f` debe mostrar actividad.
3. En la vista de la exploración debe aparecer la miniatura (capturas servidas
   desde el endpoint de la fase 5.6 contra las imágenes guardadas en el VPS).
   Como las capturas viven en el VPS del worker, el **API** debe poder leer
   ese mismo almacenamiento — hoy esto implica que el worker y el API corran
   en la misma máquina (o que `/var/lib/autoqa/explorations` se exponga por
   NFS/S3; eso queda para una iteración futura).

## Almacenamiento de capturas y el API

Hoy `LocalScreenshotReader` del API lee del mismo filesystem donde escribe el
worker. En el VPS esto funciona si el API también está en el VPS. Para
desplegar el API en Hostinger y el worker en un VPS aparte, hace falta un
adaptador de almacenamiento compartido (S3 / Spaces). Está planeado — por
ahora, dos opciones:

- **Mismo VPS**: desplegar API + worker en el mismo host. Más simple.
- **Fase intermedia**: dejar la UI mostrar solo la lista de páginas (sin
  miniatura) mientras se termina el adaptador S3.

## Actualizaciones

Para desplegar una versión nueva:

```bash
ssh root@tu-vps
cd /opt/autoqa
sudo -u autoqa git pull
sudo -u autoqa npx prisma generate
sudo -u autoqa npm --workspace apps/explorer run build
systemctl restart autoqa-explorer.service
```

Las migraciones de Prisma las corre el que despliega el API, no el worker.

## Observabilidad y troubleshooting

- `journalctl -u autoqa-explorer -n 200 --no-pager` — últimas 200 líneas.
- `systemctl status autoqa-explorer` — estado y último exit code.
- `ls -la /var/lib/autoqa/explorations | wc -l` — número de capturas guardadas.
- Si Chromium falla con `Failed to move to new namespace`:
  comprobar sysctls de user namespaces (ver paso 3).
- Si el worker reinicia en bucle: casi siempre `DATABASE_URL` mal o el host
  Postgres no acepta conexiones desde la IP del VPS (whitelist en Neon).

## Limpieza

Capturas y binarios de Playwright viven en `/var/lib/autoqa`. Rotación
pendiente: hoy no hay job que borre capturas viejas. Hasta que lo agreguemos,
vigilar `du -sh /var/lib/autoqa/explorations`.

## Seguridad

- `/etc/autoqa/explorer.env` tiene `DATABASE_URL`: modo 0640, grupo `autoqa`.
  Nunca lo pegues en logs ni lo versiones.
- El worker corre como usuario no privilegiado con capacidades vacías y
  `ProtectSystem=strict`.
- La red de salida no está filtrada por el firewall del VPS: el worker podría
  alcanzar hosts internos de la nube del proveedor. `url-guard` ya bloquea
  rangos privados y metadatos cloud, pero vale la pena añadir reglas de
  salida con `ufw` o nftables si el proveedor expone una red interna
  compartida.

## Checklist de aceptación de Fase 5.8

- [ ] `systemctl is-enabled autoqa-explorer` → `enabled`.
- [ ] `systemctl is-active autoqa-explorer` → `active (running)`.
- [ ] Encolar una exploración desde la UI → pasa a `COMPLETED` en < 2 min.
- [ ] En la vista de la exploración aparecen páginas con capturas.
- [ ] `journalctl -u autoqa-explorer` no muestra errores recurrentes.

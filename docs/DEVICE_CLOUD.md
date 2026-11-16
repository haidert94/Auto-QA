# Device cloud — ejecutar pruebas en dispositivos reales

AutoQA puede delegar la ejecución de un `TestRun` a un proveedor de
dispositivos remotos (semana 7). Hoy se soporta **BrowserStack**; el
patrón se extiende a Sauce Labs / LambdaTest con la misma estructura.

## Por qué existe esto

El worker local corre Chromium / Firefox / WebKit **emulados**. Eso
cubre pruebas funcionales, mobile emulado y compatibilidad razonables.
Pero no cubre:

- Safari **real** en macOS y iOS.
- Edge legacy.
- Comportamientos específicos de un iPhone o Pixel físico (giroscopio,
  cámara, biometría, red móvil).
- Navegadores de versiones antiguas que un cliente de banca aún soporta.

Para esos casos AutoQA se conecta a la nube del proveedor vía el
protocolo CDP de Playwright y corre el mismo spec contra un browser
remoto.

## Configurar BrowserStack

1. Crea una cuenta y obtén tus credenciales en
   https://www.browserstack.com/accounts/settings → sección
   "Automate: Access Keys".
2. En el worker (archivo `/etc/autoqa/explorer.env` descrito en
   [EXPLORER_DEPLOY.md](EXPLORER_DEPLOY.md)) añade:

   ```ini
   AUTOQA_BROWSERSTACK_USERNAME=tu_usuario
   AUTOQA_BROWSERSTACK_ACCESS_KEY=tu_access_key
   # Opcional: identificador de build para agrupar sesiones en el dashboard.
   AUTOQA_BROWSERSTACK_BUILD=autoqa-piloto
   ```
3. Reinicia el worker: `systemctl restart autoqa-explorer`.

Sin estas env vars, los runs con `targetProvider = BROWSERSTACK` se
marcan como `FAILED` con `errorCode = provider-not-configured`. Los
runs locales siguen funcionando sin esta configuración.

## Cómo elegir el proveedor en la UI

En el panel de ejecuciones del escenario, el dropdown
"**Dónde se ejecuta**" tiene dos valores:

- **Local · worker AutoQA** (default): usa Chromium / Firefox / WebKit
  del propio worker.
- **BrowserStack · dispositivos reales**: conecta el run a la nube de
  BrowserStack. Los valores de "Navegador" y "Dispositivo" se mapean
  a los `caps` del proveedor.

Mapeo actual browser → caps BrowserStack:

| AutoQA     | BrowserStack `browser`     |
|------------|----------------------------|
| CHROMIUM   | `playwright-chromium`      |
| FIREFOX    | `playwright-firefox`       |
| WEBKIT     | `playwright-webkit`        |

Si eliges un **dispositivo** (p. ej. `iPhone 15`), se envía como
`deviceName` en los caps. BrowserStack mapea esos nombres a sus
dispositivos físicos; nombres que no reconozca hacen fallar el run
con mensaje de BrowserStack.

## Qué AutoQA sigue haciendo igual

- El spec Playwright generado es **idéntico** al local. La diferencia
  está solo en `playwright.config.ts`, que emite `use.connectOptions.
  wsEndpoint` apuntando al CDP de BrowserStack.
- El **filtro SSRF** del arnés (allowlist de hosts, paths, bloqueo de
  IPs literales) sigue aplicándose en el `context.route` dentro del
  browser remoto.
- El **trace.zip** se genera igual y se sube al storage.
- La **cuota** de browser-seconds se contabiliza igual (el worker
  mide tiempo total, no uso del proveedor).

## Qué cambia cuando corre en el proveedor

- **Costo externo**: cada minuto de BrowserStack cuenta contra tu
  plan con ellos. AutoQA no lo factura; es tu contrato con el
  proveedor.
- **Latencia**: cada acción Playwright pasa por la red hasta
  BrowserStack. Esperar 1-3 s extra por `click` es normal.
- **Session URL**: BrowserStack genera un enlace al video de la
  sesión en su dashboard. AutoQA intenta extraerlo de los attachments
  del reporter JSON y lo guarda en `TestRun.providerSessionUrl`; en
  la UI aparece como enlace "Sesión remota ↗".
- **Cambios de IP**: BrowserStack asigna IPs residenciales del país
  del dispositivo. El SSRF guard sigue actuando a nivel URL pero el
  tráfico sale desde IPs que el cliente no controla.

## Limitaciones

- **Credenciales por organización**: hoy BrowserStack usa UNA cuenta
  global del operador AutoQA. Cuando llegue soporte multi-tenant real,
  cada org traerá sus propias credenciales (modelo nuevo
  `OrgIntegration` con secretos cifrados).
- **Sauce Labs / LambdaTest**: no implementados. El ganchillo está:
  `targetProvider` acepta cualquier valor y el worker resuelve el
  `wsEndpoint`. Añadir un provider nuevo es una función
  `buildSauceWsEndpoint(...)` siguiendo el patrón de BrowserStack.
- **Testing real**: AutoQA no se probó contra BrowserStack en el
  commit original (no hay cuenta disponible). El código compila y
  los tests del generador pasan, pero la primera corrida real debe
  validarse con credenciales de prueba.
- **App móvil nativa (.ipa / .apk)**: hoy solo mobile *web*.
  BrowserStack App Automate soporta Appium y es otra integración.

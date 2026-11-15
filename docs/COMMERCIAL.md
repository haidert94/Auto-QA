# Página comercial, cuentas y contratación de AutoQA

La página pública y el espacio privado comparten Next.js. Los formularios usan rutas del mismo origen que reenvían las solicitudes a NestJS. El backend comprueba la sesión, la organización y la vigencia de la suscripción antes de servir proyectos o documentos. El catálogo y las suscripciones se guardan en PostgreSQL. Los proyectos anteriores conservan sus datos y un identificador de organización vacío.

| Etapa | Cambios principales | Comprobación |
| --- | --- | --- |
| Arquitectura | `apps/web/app/autoqa-server.ts`, `apps/web/app/api` y `apps/api/src/commerce`. | El catálogo es público y proyectos y documentos se aíslan por organización. |
| Portada | `apps/web/app/page.tsx`, `commercial.tsx` y `commercial.css`. | Vista de escritorio y móvil, navegación, comparación y selección de plan. |
| Cuentas | `apps/web/app/[flow]/page.tsx`, `account-forms.tsx`, `account.ts` y `workspace.guard.ts`. | Registro, verificación, inicio de sesión, recuperación y acceso a proyectos propios. |
| Catálogo y estados | `prisma/schema.prisma`, migración `20261115000003_commercial` y `payments.ts`. | Precios en COP, límites de aplicaciones y roles, activación, fallo, cancelación y vencimiento. |
| Integración de pagos | `PaymentProvider`, referencia de contratación y bitácora `BillingEvent`. | Firma, vigencia del evento, importe persistido y repetición idempotente. |
| Pruebas | `apps/api/test/commerce.test.cjs` y `apps/web/test/commercial.e2e.cjs`. | Casos unitarios y de PostgreSQL, más un recorrido en Chrome. |

## Puesta en marcha en Windows

Con PostgreSQL iniciado y una base creada, ejecuta estos comandos desde la raíz del proyecto en PowerShell.

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run build
```

Configura estas variables en el `.env` de la raíz para la evaluación local.

```dotenv
AUTOQA_ACCOUNT_ORIGIN=http://localhost:3000
AUTOQA_INTERNAL_API_URL=http://127.0.0.1:3001/api
AUTOQA_MAIL_MODE=mailpit
AUTOQA_SMTP_HOST=127.0.0.1
AUTOQA_SMTP_PORT=1025
AUTOQA_MAIL_FROM=no-reply@autoqa.local
AUTOQA_PAYMENTS_MODE=sandbox
AUTOQA_TRIAL_DAYS=0
```

Agrega una clave aleatoria de 64 caracteres hexadecimales en `AUTOQA_SANDBOX_PAYMENT_SECRET`. Este bloque conserva una clave válida existente y evita imprimir su valor.

```powershell
$lines = @(Get-Content -LiteralPath .env)
if (-not ($lines -match '^AUTOQA_SANDBOX_PAYMENT_SECRET=[a-f0-9]{64}$')) {
  $sandboxKey = node -p "require('node:crypto').randomBytes(32).toString('hex')"
  $lines = @($lines | Where-Object { $_ -notmatch '^AUTOQA_SANDBOX_PAYMENT_SECRET=' })
  $lines + "AUTOQA_SANDBOX_PAYMENT_SECRET=$sandboxKey" | Set-Content -LiteralPath .env -Encoding utf8
  Remove-Variable sandboxKey
}
```

Abre dos terminales y ejecuta `npm.cmd run dev:api` y `npm.cmd run dev:web`. Visita [la página comercial](http://localhost:3000).

1. Selecciona un plan en **Precios** y crea una cuenta con datos sintéticos.
2. Abre el mensaje de verificación en [Mailpit](http://localhost:8025) y sigue el enlace. **Recuperar acceso** usa el mismo buzón. Configura el servicio con la [guía de correo](../README.md#verificación-de-correo-en-windows).
3. Inicia sesión. En **Facturación**, selecciona **Iniciar contratación** y **Simular aprobación**. También puedes simular un fallo y volver a iniciar la contratación.
4. Abre el dashboard y registra una aplicación. Cancela la suscripción de prueba desde **Facturación** para verificar el bloqueo posterior.

La simulación usa importes de catálogo, trabaja en COP y mantiene vigencias mensuales sin renovación automática. `AUTOQA_TRIAL_DAYS` admite de 1 a 30 días para activar un período de prueba por organización.

## Capacidades, límites y consumo

La migración `20261115000004_plan_capabilities` carga los precios preliminares y las capacidades de Starter, Pro y Business en PostgreSQL. Los límites transversales de aplicaciones, roles y simultaneidad viven en `Plan`. `PlanCapability` almacena estados, niveles y límites específicos por plan. La API publica esta matriz para la portada y la guía de contratación. Las cotizaciones de pago ya emitidas conservan su importe. El backend permite conservar o reducir los roles existentes que superen el límite actualizado.

- **Operativa** identifica una capacidad implementada e incluida en el plan. El análisis documental mediante reglas y el IPA están operativos; el proveedor de IA documental y el ICSP figuran como **Próximamente**.
- **Beta** está disponible como estado del catálogo para módulos implementados y aprobados para beta. Actualmente no hay capacidades en beta.
- **Próximamente** indica que la capacidad depende de un módulo pendiente. Aplica a la automatización funcional, API, navegadores, responsive, los monitores de disponibilidad y de flujos críticos, performance, CI/CD, trazabilidad y reportes de ejecución. Cambiar el estado en PostgreSQL requiere que el módulo correspondiente tenga soporte en el backend para publicarlo como Operativa o Beta.

En **Facturación**, `GET /api/commerce/usage` devuelve el consumo de la organización autenticada. Los contadores incluyen aplicaciones activas, roles por aplicación, segundos de navegador y sus reservas, ejecuciones, monitores y performance. Las ejecuciones completadas se imputan al mes calendario UTC en que se reservaron. Las reservas activas de meses anteriores cuentan para la simultaneidad y para el cálculo de capacidad disponible. La API no incluye tokens de IA.

`MeteredRun` y `MeteredMonitor` permiten reservar cuota y registrar consumo cuando se integren los motores. El backend serializa reservas por organización y comprueba suscripción vigente, pertenencia del proyecto y estado `READY`. La cuota de performance se configura por plan en `PlanCapability.monthlyLimit`, para el código `PERFORMANCE_TESTS`. Pro y Business comienzan con cuota cero, pendiente de acordar el número mensual. La activación requiere autorización explícita registrada, controles de seguridad y pruebas de integración del motor. No hay un endpoint de ejecución o de alta de monitores en esta entrega.

## Operación y separación de dominios

Cada registro crea una organización y su suscripción pendiente. Una sesión usa una cookie `HttpOnly` y `SameSite=Lax`, con alcance de host. NestJS guarda el hash del identificador de sesión y revoca las sesiones al restablecer la contraseña. Los cuerpos de registro y recuperación pasan por validación y límites por dirección de origen y correo. En despliegues con varias instancias, usa límites compartidos en la capa de entrada.

Puedes mantener temporalmente los proyectos anteriores disponibles en localhost con `AUTOQA_LEGACY_MODE=true` y la clave documental existente. Este modo solo sirve filas sin organización. Las cuentas verificadas usan su organización y requieren una suscripción vigente incluso cuando la compatibilidad local está activa. Con `AUTOQA_DEPLOYMENT=hosted`, los modos de compatibilidad, Mailpit y cobros simulados quedan deshabilitados.

Para dominios separados, `AUTOQA_PUBLIC_WORKSPACE_ORIGIN` define el origen de las llamadas a registro e inicio de sesión desde marketing. Configura `AUTOQA_ACCOUNT_ORIGIN` en el origen HTTPS del espacio privado y `AUTOQA_INTERNAL_API_URL` en la API de confianza. Las credenciales de sesión permanecen en el espacio privado. El despliegue deberá enrutar esos orígenes y configurar sus servicios.

El adaptador disponible verifica y registra eventos de prueba. Para incorporar Wompi en Colombia, agrega un adaptador para crear y validar referencias, usar las fuentes de pago y comprobar la firma de sus eventos. Antes del lanzamiento quedan pendientes la configuración y validación del proveedor transaccional de correo, la validación del proveedor con credenciales de prueba, la renovación real, la facturación, los impuestos y los textos legales del servicio comercial. [Fuentes de pago de Wompi](https://docs.wompi.co/docs/colombia/fuentes-de-pago/) y [verificación de eventos](https://docs.wompi.co/docs/colombia/eventos/).

## Repetir las pruebas

Usa una base PostgreSQL separada, ya migrada, con `AUTOQA_TEST_DATABASE_URL`. La prueba comercial y E2E requieren Mailpit en los puertos 1025 y 8025. Para usar otros puertos, configura `AUTOQA_TEST_SMTP_HOST`, `AUTOQA_TEST_SMTP_PORT` y `AUTOQA_TEST_MAILPIT_URL`. La prueba E2E usa Google Chrome y los puertos locales 3100 y 3101.

```powershell
npm.cmd run test:plans
npm.cmd run test:commerce
npm.cmd run test:onboarding
npm.cmd run test:documents
npm.cmd run test:commerce:e2e
```

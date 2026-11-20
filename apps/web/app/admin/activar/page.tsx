// Página admin para activar manualmente suscripciones (demo sin
// pasarela). No tiene SSR protegido: la protección real está en el
// backend, que exige X-Admin-Token válido comparado timing-safe con
// AUTOQA_ADMIN_TOKEN. Quien abra la URL ve un formulario que es inútil
// sin el token admin.

import { ActivationForm } from './activation-form';
import { CleanupTracesForm } from './cleanup-traces-form';

export const metadata = { title: 'Operaciones admin · AutoQA', robots: { index: false, follow: false } };

export default function AdminActivate() {
  return <main>
    <section className="panel" style={{ maxWidth: 640 }}>
      <h1>Activar suscripción (admin)</h1>
      <p className="muted">
        Activa manualmente la suscripción de una cuenta usando el token admin
        del servidor (<code>AUTOQA_ADMIN_TOKEN</code>). Pensado para entornos
        donde todavía no hay pasarela de pago conectada. El token no se guarda
        en el navegador; solo viaja en esta petición.
      </p>
      <ActivationForm/>
    </section>
    <section className="panel" style={{ maxWidth: 640, marginTop: 24 }}>
      <h1>Limpiar trazas huérfanas</h1>
      <p className="muted">
        Recorre los <code>TestResult.evidenceKey</code> en la base de datos y
        los pone a <code>null</code> cuando el archivo ya no está en el storage
        de evidencias. Útil tras un cambio de runtime o si el worker externo
        dejó de correr. No borra ningún archivo; solo limpia referencias rotas.
      </p>
      <CleanupTracesForm/>
    </section>
  </main>;
}

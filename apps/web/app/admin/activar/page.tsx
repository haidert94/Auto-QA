// Página admin para activar manualmente suscripciones (demo sin
// pasarela). No tiene SSR protegido: la protección real está en el
// backend, que exige X-Admin-Token válido comparado timing-safe con
// AUTOQA_ADMIN_TOKEN. Quien abra la URL ve un formulario que es inútil
// sin el token admin.

import { ActivationForm } from './activation-form';

export const metadata = { title: 'Activar suscripción · AutoQA', robots: { index: false, follow: false } };

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
  </main>;
}

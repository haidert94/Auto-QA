'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

// Formulario inline: el invitado crea su cuenta y acepta la invitación
// en un solo paso. El email viene fijo de la invite (readonly) para que
// no pueda cambiarse — sería un intento de registrar OTRA cuenta con esta
// invitación. La contraseña debe tener al menos 12 chars (mismo mínimo que
// el flujo /registro).
export function ClaimForm({ token, email, name }: {
  token: string; email: string; name: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('La contraseña debe tener al menos 12 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/commerce/members/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.message ?? 'No se pudo crear la cuenta.');
        return;
      }
      // Cookie de sesión seteada por el proxy. Redirigimos al dashboard,
      // que ya cargará con la nueva sesión.
      router.push('/projects');
    } catch { setError('No se pudo comunicar con la API.'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="invite-claim" autoComplete="off">
      <h2>Crea tu cuenta y únete</h2>
      {name && <p className="muted"><small>Nombre registrado: <strong>{name}</strong>.</small></p>}
      <label>Correo
        <input type="email" value={email} readOnly disabled/>
      </label>
      <label>Contraseña nueva
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          autoComplete="new-password" minLength={12} maxLength={128} required/>
        <small className="muted">Mínimo 12 caracteres.</small>
      </label>
      <label>Confirmar contraseña
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password" minLength={12} maxLength={128} required/>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Creando cuenta…' : 'Crear cuenta y aceptar invitación'}
      </button>
    </form>
  );
}

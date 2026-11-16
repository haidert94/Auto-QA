'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AcceptButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function accept() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/commerce/members/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.message ?? 'No se pudo aceptar la invitación.'); return; }
      setDone(true);
      setTimeout(() => router.push('/projects'), 1500);
    } catch { setError('No se pudo aceptar la invitación.'); }
    finally { setBusy(false); }
  }

  if (done) return <p className="success" role="status">Te uniste a la organización. Redirigiendo…</p>;
  return <div className="invite-cta">
    <button type="button" onClick={accept} disabled={busy}>
      {busy ? 'Aceptando…' : 'Aceptar invitación'}
    </button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

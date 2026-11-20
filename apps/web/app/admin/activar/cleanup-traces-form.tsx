'use client';

import { useState, type FormEvent } from 'react';

type Result = { scanned?: number; cleared?: number; message?: string | string[] };

export function CleanupTracesForm() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const token = String(new FormData(form).get('token') ?? '').trim();
    setWorking(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/commerce/admin/cleanup-traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = Array.isArray(payload.message) ? payload.message.join(' ') : payload.message;
        setError(message ?? ('Error ' + response.status));
        return;
      }
      setResult(payload);
      form.reset();
    } catch {
      setError('No se pudo comunicar con el servidor.');
    } finally { setWorking(false); }
  }

  return <form onSubmit={submit} style={{ marginTop: 16 }}>
    <label>Token admin (AUTOQA_ADMIN_TOKEN)
      <input name="token" type="password" autoComplete="off" required
        pattern="[a-fA-F0-9]{64}" title="64 caracteres hexadecimales"/>
    </label>
    <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
      <button type="submit" disabled={working}>{working ? 'Escaneando…' : 'Limpiar huérfanas'}</button>
    </div>
    {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
    {result && <div style={{
      marginTop: 16, padding: 14, background: 'var(--success-bg)', borderRadius: 6, border: '1px solid var(--line)',
    }}>
      <p style={{ margin: 0, color: 'var(--success)' }}>
        <strong>Limpieza completada</strong><br/>
        Escaneados: {result.scanned ?? 0} · Limpiados: {result.cleared ?? 0}
      </p>
    </div>}
  </form>;
}

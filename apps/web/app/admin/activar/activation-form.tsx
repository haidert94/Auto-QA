'use client';

import { useState, type FormEvent } from 'react';

type Result = {
  email?: string; plan?: string; status?: string;
  periodEndsAt?: string; organizationId?: string;
  message?: string | string[];
};

export function ActivationForm() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const token = String(data.get('token') ?? '').trim();
    const email = String(data.get('email') ?? '').trim().toLowerCase();
    const plan = String(data.get('plan') ?? 'enterprise');
    const days = Number(data.get('days') ?? 365);

    setWorking(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/commerce/admin/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ email, plan, days }),
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
    <label>Email de la cuenta
      <input name="email" type="email" required maxLength={254}/>
    </label>
    <label>Plan
      <select name="plan" defaultValue="enterprise" required>
        <option value="essentials">Essentials</option>
        <option value="professional">Professional</option>
        <option value="business">Business</option>
        <option value="enterprise">Enterprise</option>
      </select>
    </label>
    <label>Días de vigencia
      <input name="days" type="number" min={1} max={365} defaultValue={365} required/>
    </label>

    <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
      <button type="submit" disabled={working}>{working ? 'Activando…' : 'Activar suscripción'}</button>
    </div>

    {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
    {result && <div style={{
      marginTop: 16, padding: 14, background: 'var(--success-bg)', borderRadius: 6, border: '1px solid var(--line)',
    }}>
      <p style={{ margin: 0, color: 'var(--success)' }}>
        <strong>Suscripción activada</strong><br/>
        {result.email} · plan {result.plan} · estado {result.status}
        {result.periodEndsAt && ' · vence ' + new Date(result.periodEndsAt).toLocaleDateString('es-CO')}
      </p>
    </div>}
  </form>;
}

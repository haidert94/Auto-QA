'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { Account, Plan } from './autoqa-server';

type Mode = 'register' | 'login' | 'verify' | 'forgot' | 'reset' | 'resend';
const labels: Record<Mode, string> = {
  register: 'Crear mi cuenta', login: 'Iniciar sesión', verify: 'Verificar correo', forgot: 'Solicitar recuperación',
  reset: 'Guardar nueva contraseña', resend: 'Reenviar verificación',
};

async function submit(action: string, data: Record<string, string | undefined> = {}) {
  const response = await fetch('/api/commerce/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(result.message)
    ? result.message.join(' ') : result.message ?? 'No se pudo completar la operación.');
  return result as { message?: string; channel?: 'mailpit' | 'smtp' };
}

export function AccountForm({ mode, plans = [], plan }: { mode: Mode; plans?: Plan[]; plan?: string }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [token, setToken] = useState('');
  const [done, setDone] = useState(false);
  const [mailpit, setMailpit] = useState(false);

  useEffect(() => {
    if (mode !== 'verify' && mode !== 'reset') return;
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (value && /^[a-f0-9]{64}$/.test(value)) {
      setToken(value);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [mode]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true); setError(''); setMessage('');
    const fields = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value)]));
    const payload = mode === 'register' ? { ...fields, company: fields.company || undefined } : fields;
    try {
      const result = await submit(mode, payload);
      if (mode === 'login') { window.location.assign('/dashboard'); return; }
      setMessage(result.message ?? 'Solicitud completada.');
      setMailpit(result.channel === 'mailpit');
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar la operación.');
    } finally { setWorking(false); }
  }

  return <>
    {mode === 'register' && !plans.length && <p role="status">El catálogo de planes está temporalmente fuera de servicio.</p>}
    {!done && (mode !== 'register' || !!plans.length) && <form onSubmit={save}>
      {mode === 'register' && <>
        <label>Plan<select name="plan" required defaultValue={plans.some(item => item.code === plan) ? plan : ''}>
          <option value="" disabled>Selecciona un plan</option>
          {plans.map(item => <option key={item.code} value={item.code}>{item.name} · {item.priceCop.toLocaleString('es-CO')} COP/mes</option>)}
        </select></label>
        <label>Nombre completo<input name="name" autoComplete="name" maxLength={100} required/></label>
        <label>Empresa (opcional)<input name="company" autoComplete="organization" maxLength={120}/></label>
      </>}
      {['register', 'login', 'forgot', 'resend'].includes(mode) &&
        <label>Correo electrónico<input name="email" type="email" autoComplete="email" maxLength={254} required/></label>}
      {['register', 'login', 'reset'].includes(mode) && <label>{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}
        <input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={12} maxLength={128} required/>
      </label>}
      {(mode === 'verify' || mode === 'reset') && (token
        ? <input type="hidden" name="token" value={token}/>
        : <label>Código del mensaje<input name="token" autoComplete="off" pattern="[a-f0-9]{64}" required/></label>)}
      {mode === 'register' && <>
        <p className="muted">Usa datos de prueba y una contraseña exclusiva para esta cuenta local.</p>
        <label className="check"><input name="consentVersion" type="checkbox" value="local-1" required/>
          <span>Acepto las <Link href="/terminos" target="_blank">condiciones de evaluación</Link> y la <Link href="/privacidad" target="_blank">política de privacidad local</Link>.</span>
        </label>
      </>}
      <button className="button primary" type="submit" disabled={working}>{working ? 'Un momento…' : labels[mode]}</button>
    </form>}
    {message && <div className="success" role="status">
      <p>{message}</p>
      {mailpit && <p><a href="http://localhost:8025" target="_blank" rel="noreferrer">Abrir buzón de desarrollo en Mailpit</a></p>}
    </div>}
    {mode === 'register' && (message || error) && <p><Link href="/reenviar">Reenviar verificación</Link></p>}
    {error && <p className="error" role="alert">{error}</p>}
    {mode === 'register' || mode === 'resend' || mode === 'forgot' || mode === 'reset' || mode === 'verify'
      ? <p><Link href="/login">Ir a Iniciar sesión</Link></p>
      : <p><Link href="/recuperar">Recuperar acceso</Link> · <Link href="/reenviar">Reenviar verificación</Link> · <Link href="/registro">Crear cuenta</Link></p>}
  </>;
}

const states: Record<string, string> = {
  PENDING: 'Pendiente', ACTIVE: 'Activa', TRIALING: 'En período de prueba', PAYMENT_FAILED: 'Pago fallido',
  CANCELED: 'Cancelada', EXPIRED: 'Vencida',
};

export function BillingForm({ account, plans }: { account: Account; plans: Plan[] }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const subscription = account.subscription;
  async function run(action: string, data?: Record<string, string>) {
    setError(''); setBusy(true);
    try { await submit(action, data); window.location.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }

  return <>
    <p>Estado · <strong>{states[subscription.status]}</strong>{subscription.plan && ' · ' + subscription.plan.name}</p>
    {subscription.periodEndsAt && <p>Vigencia indicada · {subscription.periodEndsAt.slice(0, 10)}</p>}
    {subscription.quotedPriceCop && <p>Valor simulado · {subscription.quotedPriceCop.toLocaleString('es-CO')} COP</p>}
    {account.sandbox
      ? <p className="muted">Modo de prueba. Las operaciones de esta página son simuladas y no solicitan datos de tarjeta.</p>
      : <p role="status">La contratación se habilitará cuando esté configurada la pasarela.</p>}
    {['ACTIVE', 'TRIALING'].includes(subscription.status) && <p><Link className="button primary" href="/dashboard">Entrar al dashboard</Link></p>}
    {account.sandbox && !['ACTIVE', 'TRIALING'].includes(subscription.status) && plans.length > 0 && <form onSubmit={event => {
      event.preventDefault();
      const plan = new FormData(event.currentTarget).get('plan');
      if (typeof plan === 'string') void run('checkout', { plan });
    }}>
      <label>Plan<select name="plan" defaultValue={subscription.plan?.code} required>
        {plans.map(plan => <option key={plan.code} value={plan.code}>{plan.name} · {plan.priceCop.toLocaleString('es-CO')} COP/mes</option>)}
      </select></label><button type="submit" className="button primary" disabled={busy}>Iniciar contratación</button>
    </form>}
    {account.sandbox && subscription.checkoutPrepared && ['PENDING', 'TRIALING'].includes(subscription.status) && <div className="actions">
      <button className="button primary" type="button" disabled={busy} onClick={() => run('simulate', { outcome: 'approved' })}>Simular aprobación</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => run('simulate', { outcome: 'failed' })}>Simular pago fallido</button>
    </div>}
    {account.sandbox && ['ACTIVE', 'TRIALING'].includes(subscription.status) &&
      <button className="secondary" type="button" disabled={busy} onClick={() => run('cancel')}>Cancelar suscripción de prueba</button>}
    {error && <p role="alert" className="error">{error}</p>}
  </>;
}

export function Logout() {
  const [error, setError] = useState('');
  return <>
    <button type="button" className="secondary" onClick={async () => {
      try { await submit('logout'); window.location.assign('/'); } catch { setError('No se pudo cerrar la sesión.'); }
    }}>Cerrar sesión</button>
    {error && <p role="alert" className="error">{error}</p>}
  </>;
}

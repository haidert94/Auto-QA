'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';

const ENV_TYPES = [
  { value: 'DEVELOPMENT', label: 'Desarrollo' },
  { value: 'QA', label: 'QA' },
  { value: 'STAGING', label: 'Preproducción' },
  { value: 'PRODUCTION', label: 'Producción' },
] as const;

const ACCESS_MODES = [
  { value: 'PUBLIC', label: 'Pública · sin inicio de sesión' },
  { value: 'PRIVATE', label: 'Privada · usuario y contraseña' },
  { value: 'SSO', label: 'SSO · inicio de sesión único' },
] as const;

type Form = {
  name: string;
  description: string;
  ownerLabel: string;
  envType: typeof ENV_TYPES[number]['value'] | '';
  baseUrl: string;
  accessMode: typeof ACCESS_MODES[number]['value'] | '';
  allowedHosts: string;
  authorizationConfirmed: boolean;
  readOnly: boolean;
};

const EMPTY: Form = {
  name: '', description: '', ownerLabel: '',
  envType: 'QA', baseUrl: '', accessMode: '',
  allowedHosts: '', authorizationConfirmed: false, readOnly: true,
};

function hostFromUrl(value: string): string {
  try { return new URL(value).hostname; } catch { return ''; }
}

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const defaultHost = useMemo(() => hostFromUrl(form.baseUrl), [form.baseUrl]);
  const hostsText = form.allowedHosts.trim() || defaultHost;

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function canProceed(current: number): boolean {
    if (current === 1) return form.name.trim().length >= 2;
    if (current === 2) return !!form.envType && !!form.baseUrl.trim() && !!form.accessMode && hostFromUrl(form.baseUrl) !== '';
    if (current === 3) return form.authorizationConfirmed && (hostsText.length > 0) && form.readOnly;
    return true;
  }

  function next() { if (canProceed(step)) setStep(s => Math.min(4, s + 1)); }
  function back() { setStep(s => Math.max(0, s - 1)); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const allowedHosts = (form.allowedHosts.trim() || defaultHost)
        .split(/\r?\n|,/).map(h => h.trim()).filter(Boolean);
      const response = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'READY',
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          ownerLabel: form.ownerLabel.trim() || undefined,
          priorityModules: [],
          environments: [{
            type: form.envType,
            baseUrl: form.baseUrl.trim(),
            accessMode: form.accessMode,
            authorizationConfirmed: form.authorizationConfirmed,
            authorizedAt: new Date().toISOString(),
            readOnly: form.readOnly,
            allowedHosts,
            allowedPaths: [],
            excludedPaths: [],
            prohibitedActions: [],
            testData: {},
          }],
          roles: [],
          executionSettings: {},
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(typeof payload.message === 'string' ? payload.message
          : Array.isArray(payload.message) ? payload.message.join(' · ')
          : 'No se pudo crear el proyecto.');
        return;
      }
      const project = await response.json();
      router.push(`/projects/${project.id}`);
    } catch { setError('No se pudo crear el proyecto. Revisa la conexión.'); }
    finally { setBusy(false); }
  }

  const steps = ['Bienvenida', 'Aplicación', 'Entorno', 'Alcance y autorización', 'Confirmar'];

  return <form onSubmit={submit} className="panel onboarding-wizard">
    <ol className="wizard-steps">
      {steps.map((label, i) => <li key={i} className={
        i === step ? 'current' : i < step ? 'done' : 'pending'
      }>{i + 1}. {label}</li>)}
    </ol>

    {step === 0 && <section>
      <h1>Bienvenido a AutoQA</h1>
      <p className="muted">
        En 4 pasos vas a dejar lista una aplicación para medir su calidad con evidencia trazable.
        El alcance y la autorización son parte del contrato: AutoQA no toca nada fuera de lo que declares aquí.
      </p>
      <ul className="wizard-bullets">
        <li><strong>1.</strong> Dinos cuál es la aplicación y quién eres.</li>
        <li><strong>2.</strong> Declara el entorno que vas a probar (URL base, tipo, forma de acceso).</li>
        <li><strong>3.</strong> Define el alcance (qué dominios AutoQA puede visitar) y confirma que estás autorizado.</li>
        <li><strong>4.</strong> Revisa y crea el proyecto.</li>
      </ul>
      <p className="muted">
        Después podrás subir documentación, crear escenarios y ejecutar pruebas contra ese entorno.
      </p>
    </section>}

    {step === 1 && <section>
      <h1>Aplicación</h1>
      <label>Nombre de la aplicación
        <input value={form.name} onChange={e => update('name', e.target.value)}
               placeholder="App de reservas, Portal de clientes, …" maxLength={120} required autoFocus/>
      </label>
      <label>Descripción breve (opcional)
        <textarea value={form.description} onChange={e => update('description', e.target.value)}
                  placeholder="¿Qué hace esta aplicación? Para qué público es?"
                  rows={3} maxLength={500}/>
      </label>
      <label>Propietario del lado del cliente (opcional)
        <input value={form.ownerLabel} onChange={e => update('ownerLabel', e.target.value)}
               placeholder="Nombre del dueño de producto o área responsable" maxLength={120}/>
      </label>
    </section>}

    {step === 2 && <section>
      <h1>Entorno autorizado</h1>
      <p className="muted">Puedes añadir más entornos después. Empezamos con el primero.</p>
      <label>Tipo
        <select value={form.envType} onChange={e => update('envType', e.target.value as Form['envType'])}>
          {ENV_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label>URL base
        <input type="url" value={form.baseUrl} onChange={e => update('baseUrl', e.target.value)}
               placeholder="https://qa.mi-app.com" required/>
      </label>
      {form.baseUrl && !defaultHost && <p className="error" role="alert">
        La URL no parece válida. Incluye el esquema (https://) y el host.
      </p>}
      <label>Modo de acceso
        <select value={form.accessMode} onChange={e => update('accessMode', e.target.value as Form['accessMode'])} required>
          <option value="">Seleccionar…</option>
          {ACCESS_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
    </section>}

    {step === 3 && <section>
      <h1>Alcance y autorización</h1>
      <p className="muted">
        AutoQA solo visitará dominios que estén en esta lista. Puedes ajustar rutas y exclusiones después.
      </p>
      <label>Dominios permitidos
        <textarea value={form.allowedHosts} onChange={e => update('allowedHosts', e.target.value)}
                  placeholder={defaultHost ? `${defaultHost}\napi.${defaultHost}` : 'app.mi-dominio.com'}
                  rows={3}/>
        <small className="muted">
          Un dominio por línea. Si lo dejas vacío, se usa <code>{defaultHost || '(define primero la URL base)'}</code>.
        </small>
      </label>
      <fieldset className="wizard-auth">
        <legend>Autorización</legend>
        <label className="check">
          <input type="checkbox" checked={form.authorizationConfirmed}
                 onChange={e => update('authorizationConfirmed', e.target.checked)}/>
          <span>Confirmo que soy dueño o estoy expresamente autorizado para probar esta aplicación en el entorno declarado.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.readOnly}
                 onChange={e => update('readOnly', e.target.checked)}/>
          <span>Las pruebas serán en modo <strong>solo lectura</strong> (no se envían formularios ni se modifica el estado del sistema).</span>
        </label>
        <p className="muted">
          AutoQA bloquea direcciones IP privadas, metadatos de nube y hosts fuera de esta lista. Las credenciales nunca se registran en logs ni en traces.
        </p>
      </fieldset>
    </section>}

    {step === 4 && <section>
      <h1>Revisa y crea</h1>
      <dl className="wizard-review">
        <div><dt>Aplicación</dt><dd>{form.name}</dd></div>
        {form.description && <div><dt>Descripción</dt><dd>{form.description}</dd></div>}
        {form.ownerLabel && <div><dt>Propietario</dt><dd>{form.ownerLabel}</dd></div>}
        <div><dt>Entorno</dt><dd>
          {ENV_TYPES.find(t => t.value === form.envType)?.label} · {form.baseUrl} ·{' '}
          {ACCESS_MODES.find(m => m.value === form.accessMode)?.label}
        </dd></div>
        <div><dt>Dominios</dt><dd>
          <ul>
            {(form.allowedHosts.trim() || defaultHost).split(/\r?\n|,/).map(h => h.trim()).filter(Boolean)
              .map((h, i) => <li key={i}><code>{h}</code></li>)}
          </ul>
        </dd></div>
        <div><dt>Autorización</dt><dd>Confirmada · modo solo lectura</dd></div>
      </dl>
      <p className="muted">
        Después de crear el proyecto podrás subir documentación, crear escenarios y encolar exploraciones.
      </p>
    </section>}

    {error && <p className="error" role="alert">{error}</p>}

    <div className="wizard-actions">
      {step === 0
        ? <Link href="/dashboard" className="button-like secondary">Cancelar</Link>
        : <button type="button" className="secondary" onClick={back} disabled={busy}>Volver</button>}
      {step < 4
        ? <button type="button" onClick={next} disabled={!canProceed(step)}>Siguiente</button>
        : <button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear proyecto'}</button>}
    </div>
  </form>;
}

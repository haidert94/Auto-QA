'use client';

// Modal para gestionar la sesión reusable de Playwright de un entorno. El QA
// se loguea en su navegador, exporta cookies+localStorage con
//   npx playwright codegen --save-storage=auth.json
// y sube ese archivo acá. El backend valida el shape, lo cifra con el mismo
// SecretCipher de credentialCipher y lo guarda en Environment. En los runs,
// el worker lo descifra y lo pasa a test.use({ storageState }). No pedimos
// contraseñas ni manejamos el flujo de login — la sesión ya existe en el
// browser del QA.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiProjects, type Environment } from '../onboarding';

// Shape mínimo del JSON que exporta Playwright. Lo validamos acá del lado
// cliente para dar feedback inmediato; el backend repite la validación en
// profundidad antes de guardar.
type MinimalStorageState = { cookies?: unknown[]; origins?: unknown[] };

function formatDate(iso: string | null): string {
  if (!iso) return 'sin fecha';
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt).getTime();
  return !Number.isNaN(parsed) && parsed <= Date.now();
}

export function StorageStateDialog({ projectId, environment, onClose, onUpdated }: {
  projectId: string;
  environment: Environment;
  onClose: () => void;
  onUpdated: (next: Environment['storageState']) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [parsedSummary, setParsedSummary] = useState<{ cookies: number; origins: number } | null>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function handleFile(selected: File | null) {
    setFile(selected);
    setParsedSummary(null);
    setError('');
    if (!selected) return;
    if (selected.size > 2 * 1024 * 1024) {
      setError('El archivo excede 2 MB. Exporta una sesión más acotada.');
      return;
    }
    try {
      const text = await selected.text();
      const parsed = JSON.parse(text) as MinimalStorageState;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || !Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
        setError('El archivo no tiene la forma de un storageState de Playwright (cookies[] y origins[]).');
        return;
      }
      setParsedSummary({ cookies: parsed.cookies.length, origins: parsed.origins.length });
    } catch {
      setError('No se pudo leer el archivo como JSON válido.');
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !file || !parsedSummary) return;
    setBusy(true); setError('');
    try {
      const text = await file.text();
      const storageState = JSON.parse(text) as unknown;
      const payload: Record<string, unknown> = { storageState };
      if (label.trim()) payload.label = label.trim();
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();
      const response = await fetch(
        `${apiProjects}/${projectId}/environments/${environment.id}/storage-state`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(typeof data.message === 'string' ? data.message
          : Array.isArray(data.message) ? data.message.join('; ')
          : 'No se pudo subir la sesión.');
        return;
      }
      const summary = await response.json() as { label: string | null; uploadedAt: string; expiresAt: string | null };
      onUpdated({ label: summary.label, uploadedAt: summary.uploadedAt, expiresAt: summary.expiresAt });
      onClose();
    } catch {
      setError('No se pudo subir la sesión. Reintenta.');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    if (!confirm('Eliminar la sesión reusable. Los próximos runs volverán a loguearse si corresponde. ¿Continuar?')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(
        `${apiProjects}/${projectId}/environments/${environment.id}/storage-state`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setError('No se pudo eliminar la sesión.');
        return;
      }
      onUpdated(null);
      onClose();
    } catch {
      setError('No se pudo eliminar la sesión.');
    } finally {
      setBusy(false);
    }
  }

  const current = environment.storageState;
  const expired = current ? isExpired(current.expiresAt) : false;

  return <dialog ref={dialog} className="environments-dialog" aria-labelledby="storage-state-dialog-title"
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <header className="environments-dialog__head">
      <h2 id="storage-state-dialog-title">Sesión reusable de Playwright</h2>
      <button type="button" className="secondary" onClick={onClose} disabled={busy} aria-label="Cerrar">×</button>
    </header>
    <div className="environments-dialog__form">
      <p className="muted" style={{ marginTop: 0 }}>
        Sube cookies y localStorage exportados de un navegador autenticado para que los runs no vuelvan a loguearse.
        Esta sesión da acceso al sistema como la persona que la generó: rótala con frecuencia y elimínala al terminar.
      </p>

      {current ? (
        <div className={expired ? 'env-slot env-slot--invalid' : 'env-slot'}>
          <p><strong>Sesión vigente:</strong> {current.label || 'sin etiqueta'}</p>
          <p className="muted">Subida: {formatDate(current.uploadedAt)}</p>
          <p className="muted">
            Expira: {current.expiresAt ? formatDate(current.expiresAt) : 'sin TTL'}
            {expired && ' · expirada, los runs la ignoran hasta reemplazarla'}
          </p>
          <button type="button" className="secondary" onClick={() => void clear()} disabled={busy}>
            Eliminar sesión actual
          </button>
        </div>
      ) : (
        <p className="muted">No hay sesión reusable configurada para este entorno.</p>
      )}

      <form onSubmit={upload}>
        <fieldset className="form-content" disabled={busy}>
          <h3>Subir nueva sesión</h3>
          <label className="detail-label">
            Archivo auth.json exportado de Playwright
            <input type="file" accept="application/json,.json" required
              onChange={event => void handleFile(event.target.files?.[0] ?? null)} />
          </label>
          {parsedSummary && <p className="muted">
            Detectado: {parsedSummary.cookies} cookies · {parsedSummary.origins} orígenes de localStorage.
          </p>}
          <label className="detail-label">
            Etiqueta (opcional)
            <input type="text" maxLength={80} value={label}
              placeholder="Ej.: QA admin · demo cliente · usuario lector"
              onChange={event => setLabel(event.target.value)} />
          </label>
          <label className="detail-label">
            Expira el (opcional, recomendado)
            <input type="datetime-local" value={expiresAt}
              onChange={event => setExpiresAt(event.target.value)} />
            <small className="muted">
              Si la dejas vacía, la sesión queda sin TTL. Para producción, pon un máximo de 24–72 h.
            </small>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <button type="submit" disabled={busy || !file || !parsedSummary}>
              {busy ? 'Subiendo…' : current ? 'Reemplazar sesión' : 'Subir sesión'}
            </button>
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          </div>
        </fieldset>
      </form>

      <details style={{ marginTop: '1rem' }}>
        <summary>¿Cómo exporto mi sesión?</summary>
        <ol className="muted">
          <li>Instala Playwright local (<code>npm i -D @playwright/test</code>).</li>
          <li>Ejecuta <code>npx playwright codegen {environment.baseUrl ?? '<URL>'} --save-storage=auth.json</code>.</li>
          <li>Logueate en la ventana que se abre y cierra el navegador. Playwright guarda <code>auth.json</code> en el directorio actual.</li>
          <li>Sube ese archivo acá. Nunca lo subas a Git ni lo compartas por correo.</li>
        </ol>
      </details>
    </div>
  </dialog>;
}

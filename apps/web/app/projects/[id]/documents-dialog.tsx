'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { DocumentPanel } from '../document-panel';
import { documentRequest, extensions, fileFormat, fileLimit, type PendingDocument } from '../document-client';
import type { OrgRole } from '../../autoqa-server';

type ModuleSlot = {
  id: string;
  name: string;
  file: File | null;
  state: 'IDLE' | 'UPLOADING' | 'DONE' | 'ERROR';
  error?: string;
};

function moduleSlot(): ModuleSlot {
  return { id: crypto.randomUUID(), name: '', file: null, state: 'IDLE' };
}

// El backend limita el nombre del archivo a 180 caracteres: si el prefijo del
// módulo lo empuja por encima, recortamos la base del archivo sin tocar la
// extensión para que la carga no rebote.
function prefixFilename(moduleName: string, original: string): string {
  const MAX = 180;
  const dot = original.lastIndexOf('.');
  const ext = dot > 0 ? original.slice(dot) : '';
  const base = dot > 0 ? original.slice(0, dot) : original;
  const prefix = `${moduleName} - `;
  const naive = prefix + original;
  if (naive.length <= MAX) return naive;
  const budget = Math.max(1, MAX - prefix.length - ext.length);
  return prefix + base.slice(0, budget) + ext;
}

export function DocumentsDialog({ projectId, role, onClose, onChanged }: {
  projectId: string;
  role?: OrgRole;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [moduleCount, setModuleCount] = useState(0);
  const [modules, setModules] = useState<ModuleSlot[]>([]);
  const [moduleError, setModuleError] = useState('');

  function applyModuleCount(next: number) {
    const bounded = Math.max(0, Math.min(30, Math.floor(Number.isFinite(next) ? next : 0)));
    setModuleCount(bounded);
    setModules(current => {
      if (bounded === current.length) return current;
      if (bounded < current.length) return current.slice(0, bounded);
      return [...current, ...Array.from({ length: bounded - current.length }, moduleSlot)];
    });
    setModuleError('');
  }

  function updateModule(id: string, patch: Partial<ModuleSlot>) {
    setModules(list => list.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  function pickFile(id: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!extensions.includes(fileFormat(file.name)) || !file.size || file.size > fileLimit) {
      updateModule(id, { state: 'ERROR', error: 'Formato o tamaño no admitido.' });
      return;
    }
    updateModule(id, { file, state: 'IDLE', error: undefined });
  }

  async function uploadModules() {
    const missingName = modules.filter(m => m.file && !m.name.trim());
    if (missingName.length) {
      setModules(list => list.map(item => item.file && !item.name.trim()
        ? { ...item, state: 'ERROR', error: 'Falta el nombre del módulo.' }
        : item));
      setModuleError(missingName.length === 1
        ? 'Falta el nombre de un módulo con archivo adjunto.'
        : `Faltan ${missingName.length} nombres de módulos con archivo adjunto.`);
      return;
    }
    const ready = modules.filter(m => m.name.trim() && m.file);
    if (!ready.length) {
      setModuleError('Agrega el nombre y el archivo de al menos un módulo.');
      return;
    }
    setModuleError('');
    setUploading(true);
    let changed = false;
    try {
      for (const slot of ready) {
        if (!slot.file) continue;
        updateModule(slot.id, { state: 'UPLOADING', error: undefined });
        const renamed = prefixFilename(slot.name.trim(), slot.file.name);
        const prefixed = new File([slot.file], renamed, { type: slot.file.type });
        const data = new FormData();
        data.append('files', prefixed);
        data.append('type', 'AUTO');
        try {
          await documentRequest(projectId, '', { method: 'POST', body: data });
          updateModule(slot.id, { state: 'DONE', file: null });
          changed = true;
        } catch (error) {
          updateModule(slot.id, {
            state: 'ERROR',
            error: error instanceof Error ? error.message : 'No se pudo cargar este módulo.',
          });
        }
      }
      // Encadena el análisis: al terminar la carga, el agente levanta los
      // documentos nuevos y los procesa sin que el usuario tenga que pulsar
      // "Analizar". Un fallo del análisis no borra las cargas ya guardadas.
      if (changed) {
        try {
          await documentRequest(projectId, '/analyze', { method: 'POST' });
        } catch (error) {
          setModuleError(error instanceof Error
            ? `Se cargaron los módulos, pero el análisis falló: ${error.message}`
            : 'Se cargaron los módulos, pero el análisis falló.');
        }
      }
    } finally {
      setUploading(false);
      setRevision(value => value + 1);
      if (changed) onChanged();
    }
  }

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function uploadPending(items: PendingDocument[]) {
    if (!items.length) return;
    setUploading(true);
    let changed = false;
    try {
      for (const item of items) {
        setPending(queue => queue.map(entry => entry.id === item.id
          ? { ...entry, state: 'UPLOADING', error: undefined } : entry));
        const data = new FormData();
        data.append('files', item.file);
        data.append('type', item.type);
        if (item.testTypes?.length) data.append('testTypes', JSON.stringify(item.testTypes));
        try {
          await documentRequest(projectId, '', { method: 'POST', body: data });
          setPending(queue => queue.filter(entry => entry.id !== item.id));
          changed = true;
        } catch (error) {
          setPending(queue => queue.map(entry => entry.id === item.id ? {
            ...entry, state: 'ERROR',
            error: error instanceof Error ? error.message : 'No se pudo cargar este archivo.',
          } : entry));
        }
      }
    } finally {
      setUploading(false);
      setRevision(value => value + 1);
      if (changed) onChanged();
    }
  }

  function close() {
    if (uploading) return;
    onClose();
  }

  return <dialog ref={dialog} className="environments-dialog documents-dialog" aria-labelledby="documents-dialog-title"
    onCancel={event => { if (uploading) event.preventDefault(); else onClose(); }}>
    <header className="environments-dialog__head">
      <h2 id="documents-dialog-title">Documentos asociados y contratos técnicos</h2>
      <button type="button" className="secondary" onClick={close} disabled={uploading} aria-label="Cerrar">×</button>
    </header>
    <div className="environments-dialog__form documents-dialog__body">
      <section className="modules-panel" aria-label="Módulos a documentar">
        <div className="modules-panel__count">
          <span className="modules-panel__count-label">Cantidad de módulos</span>
          <div className="modules-panel__stepper" role="group" aria-label="Cantidad de módulos">
            <button type="button" className="modules-panel__step" aria-label="Disminuir"
              onClick={() => applyModuleCount(moduleCount - 1)}
              disabled={uploading || moduleCount <= 0}>−</button>
            <span className="modules-panel__count-value" aria-live="polite">{moduleCount}</span>
            <button type="button" className="modules-panel__step" aria-label="Aumentar"
              onClick={() => applyModuleCount(moduleCount + 1)}
              disabled={uploading || moduleCount >= 30}>+</button>
          </div>
        </div>
        {modules.length > 0 && <ol className="modules-panel__list">
          {modules.map((slot, index) => (
            <li key={slot.id} className={`modules-panel__item modules-panel__item--${slot.state.toLowerCase()}`}>
              <span className="modules-panel__index">{String(index + 1).padStart(2, '0')}</span>
              <label className="modules-panel__name">
                <span>Nombre del módulo</span>
                <input type="text" maxLength={120} value={slot.name}
                  placeholder="Autenticación, Checkout, Reportes…"
                  onChange={event => {
                    const name = event.target.value;
                    updateModule(slot.id, name.trim() && slot.state === 'ERROR'
                      ? { name, state: 'IDLE', error: undefined }
                      : { name });
                    if (name.trim()) setModuleError('');
                  }}
                  disabled={uploading || slot.state === 'DONE'} />
              </label>
              <label className="modules-panel__file">
                <span>Archivo</span>
                <span className="modules-panel__file-row">
                  <span className="modules-panel__file-name">
                    {slot.state === 'DONE' ? 'Adjunto' : slot.file?.name ?? 'Sin archivo'}
                  </span>
                  <span className="modules-panel__file-button">
                    {slot.file ? 'Cambiar' : 'Adjuntar'}
                    <input type="file" accept={extensions.map(e => '.' + e).join(',')}
                      onChange={event => pickFile(slot.id, event)}
                      disabled={uploading || slot.state === 'DONE'} />
                  </span>
                </span>
              </label>
              {slot.error && <p className="error modules-panel__error" role="alert">{slot.error}</p>}
            </li>
          ))}
        </ol>}
        {modules.length > 0 && <>
          <p className="modules-panel__formats muted">
            PDF, DOCX, XLSX, CSV, TXT, MD, JSON, YAML o YML. Hasta 5 MiB por archivo.
          </p>
          <div className="modules-panel__actions">
            <button type="button" onClick={() => void uploadModules()}
              disabled={uploading || !modules.some(m => m.name.trim() && m.file)}>
              {uploading ? 'Subiendo módulos…' : 'Subir módulos'}
            </button>
            {moduleError && <p className="error" role="alert">{moduleError}</p>}
          </div>
        </>}
      </section>
      <DocumentPanel
        projectId={projectId}
        disabled={false}
        uploading={uploading}
        revision={revision}
        pending={pending}
        setPending={setPending}
        upload={items => void uploadPending(items)}
        uploadOnSelect
        role={role}
        onChanged={onChanged}
      />
      <div className="actions">
        <button type="button" className="secondary" onClick={close} disabled={uploading}>Cerrar</button>
      </div>
    </div>
  </dialog>;
}

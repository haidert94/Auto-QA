'use client';

import { useEffect, useRef, useState } from 'react';
import { DocumentPanel } from '../document-panel';
import { documentRequest, type PendingDocument } from '../document-client';
import type { OrgRole } from '../../autoqa-server';

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

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function uploadPending() {
    if (!pending.length) return;
    setUploading(true);
    let changed = false;
    try {
      for (const item of pending) {
        setPending(queue => queue.map(entry => entry.id === item.id
          ? { ...entry, state: 'UPLOADING', error: undefined } : entry));
        const data = new FormData();
        data.append('files', item.file);
        data.append('type', item.type);
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
      <DocumentPanel
        projectId={projectId}
        disabled={false}
        uploading={uploading}
        revision={revision}
        pending={pending}
        setPending={setPending}
        upload={() => void uploadPending()}
        role={role}
      />
      <div className="actions">
        <button type="button" className="secondary" onClick={close} disabled={uploading}>Cerrar</button>
      </div>
    </div>
  </dialog>;
}

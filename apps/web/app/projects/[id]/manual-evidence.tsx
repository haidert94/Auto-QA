'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, Paperclip, Trash2, X } from 'lucide-react';

type ManualScreenshot = { ordinal: number; filename: string; contentType: string; data: string };
type ResultStatus = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';

type ManualEvidenceButtonProps = {
  projectId: string;
  scenarioId: string;
  resultId?: string;
  currentStatus?: ResultStatus;
  currentScreenshots?: ManualScreenshot[];
  onSaved: () => void;
};

const STATUS_LABEL: Record<ResultStatus, string> = {
  PASSED: 'Pasó',
  FAILED: 'Falló',
  BLOCKED: 'Bloqueada',
  SKIPPED: 'Omitida',
};

export function ManualEvidenceButton(props: ManualEvidenceButtonProps) {
  const [open, setOpen] = useState(false);
  const hasEvidence = (props.currentScreenshots?.length ?? 0) > 0;
  return <>
    <button type="button" className="run-trace-link" onClick={() => setOpen(true)}>
      <Paperclip size={12} /> {hasEvidence ? 'Actualizar evidencia' : 'Adjuntar evidencia'}
    </button>
    {open && <ManualEvidenceModal {...props} onClose={() => setOpen(false)} />}
  </>;
}

function ManualImagePreview({ file, label }: { file: File; label: string }) {
  const preview = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const canvas = preview.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let active = true;
    setUnavailable(false);
    context.clearRect(0, 0, canvas.width, canvas.height);

    async function draw() {
      try {
        const bitmap = await createImageBitmap(file);
        try {
          if (!active || !canvas || !context) return;
          const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
          const width = bitmap.width * scale;
          const height = bitmap.height * scale;
          context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        } finally {
          bitmap.close();
        }
      } catch {
        if (active) setUnavailable(true);
      }
    }

    void draw();
    return () => { active = false; };
  }, [file]);

  return <>
    <canvas ref={preview} role="img" aria-label={label} width={240} height={180} hidden={unavailable} />
    {unavailable && <small>Vista previa no disponible</small>}
  </>;
}

function ManualEvidenceModal({ projectId, scenarioId, currentStatus, currentScreenshots, onSaved, onClose }: ManualEvidenceButtonProps & { onClose: () => void }) {
  const [status, setStatus] = useState<ResultStatus>(currentStatus ?? 'PASSED');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const uploadHint = useId();

  useEffect(() => {
    const trigger = document.activeElement;
    const panel = dialog.current;
    panel?.showModal();
    return () => {
      panel?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  function onPick(selection: FileList | null) {
    if (!selection) return;
    const incoming = Array.from(selection);
    const invalid = incoming.find(f => !/^image\/(png|jpe?g|webp|gif)$/i.test(f.type) || f.size > 1_500_000);
    if (invalid) {
      setError(`La imagen ${invalid.name} no es válida (PNG/JPG/WebP/GIF ≤ 1.5 MB).`);
      return;
    }
    const combined = [...files, ...incoming].slice(0, 8);
    setFiles(combined); setError('');
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.set('status', status);
      if (notes.trim()) body.set('notes', notes.trim());
      for (const file of files) body.append('screenshots', file);
      const response = await fetch(`/api/projects/${projectId}/scenarios/${scenarioId}/runs/manual`, { method: 'POST', body });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.message === 'string' ? payload.message : 'No se pudo guardar la evidencia.');
      }
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la evidencia.');
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="evidence-modal__box manual-evidence-panel" aria-label="Adjuntar evidencia manual"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <header><h3>Adjuntar evidencia</h3><button type="button" onClick={onClose} aria-label="Cerrar" disabled={busy}><X size={16} /></button></header>
    <div className="manual-evidence-body">
      <label className="manual-evidence-field">Estado del escenario
        <select value={status} onChange={event => setStatus(event.target.value as ResultStatus)}>
          {(Object.keys(STATUS_LABEL) as ResultStatus[]).map(key => <option key={key} value={key}>{STATUS_LABEL[key]}</option>)}
        </select>
      </label>
      <label className="manual-evidence-field">Notas (opcional)
        <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={2000} placeholder="Observaciones de la ejecución…" />
      </label>
      <div className="manual-evidence-upload">
        <div>
          <strong>Imágenes</strong>
          <p id={uploadHint}>Hasta 8 archivos PNG, JPG, WebP o GIF de 1,5 MB cada uno.</p>
        </div>
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
          onChange={event => { onPick(event.target.files); event.target.value = ''; }} />
        <button type="button" className="secondary" aria-describedby={uploadHint} onClick={() => picker.current?.click()}>
          <ImagePlus size={15} aria-hidden="true" />Seleccionar imágenes
        </button>
        {currentScreenshots && currentScreenshots.length > 0 && files.length === 0 && (
          <small className="muted">Evidencia actual: {currentScreenshots.length} imagen{currentScreenshots.length === 1 ? '' : 'es'}. Si subes nuevas, reemplazan a las anteriores.</small>
        )}
      </div>
      {files.length > 0 && <ol className="manual-evidence-previews">{files.map((file, index) => <li key={index}>
        <ManualImagePreview file={file} label={`Evidencia ${index + 1}`} />
        <button type="button" aria-label={`Quitar imagen ${index + 1}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}><Trash2 size={11} /></button>
      </li>)}</ol>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    <footer>
      <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button>
      <button type="button" onClick={() => void submit()} disabled={busy || (!files.length && !currentScreenshots?.length)}>
        {busy ? <><Loader2 size={13} className="spin" />Guardando…</> : 'Guardar evidencia'}
      </button>
    </footer>
  </dialog>;
}

export function ManualEvidencePreview({ screenshots }: { screenshots: ManualScreenshot[] }) {
  if (!screenshots.length) return null;
  return <ul className="manual-evidence-thumbs">{screenshots.slice(0, 4).map(shot => <li key={shot.ordinal}>
    <img src={shot.data} alt={shot.filename} loading="lazy" />
  </li>)}{screenshots.length > 4 && <li className="muted">+{screenshots.length - 4}</li>}</ul>;
}

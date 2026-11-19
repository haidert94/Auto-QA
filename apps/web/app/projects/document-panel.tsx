'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  categoryLabels, documentRequest, extensions, fileFormat, fileLimit, fileSize,
  type Category, type PendingDocument, type Report, type SavedDocument,
} from './document-client';
import { DocumentReport } from './document-report';
import type { OrgRole } from '../autoqa-server';
import { can } from '../permissions';

const states = {
  DECLARED: 'Declarado', UPLOADED: 'Cargado', PROCESSED: 'Procesado', VALIDATED: 'Validado',
  UPLOADING: 'Cargando', ERROR: 'Error de carga',
};

type Props = {
  projectId?: string;
  disabled: boolean;
  uploading: boolean;
  revision: number;
  pending: PendingDocument[];
  setPending: Dispatch<SetStateAction<PendingDocument[]>>;
  upload: () => void;
  role?: OrgRole;
  // El padre (DocumentsDialog en el tab Datos) necesita enterarse cuando
  // validamos o borramos para recargar el card "Análisis documental". Si
  // este prop no viaja (uso dentro de ProjectForm), el componente sigue
  // comportándose como antes.
  onChanged?: () => void;
};

export function DocumentPanel({ projectId, disabled, uploading, revision, pending, setPending, upload, role, onChanged }: Props) {
  const canUpload = can(role, 'document.upload');
  const canAnalyze = can(role, 'document.analyze');
  const canValidate = can(role, 'document.validate');
  const canDelete = can(role, 'document.delete');
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [busy, setBusy] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    Promise.all([
      documentRequest<SavedDocument[]>(projectId, '', { signal: controller.signal }),
      documentRequest<Report>(projectId, '/analysis', { signal: controller.signal }),
    ]).then(([list, analysis]) => {
      setDocuments(list);
      setReport(analysis);
      setError('');
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo consultar la documentación.');
    });
    return () => controller.abort();
  }, [projectId, revision, refresh]);

  function select(files: FileList) {
    if (disabled || uploading || busy) return;
    const selected: PendingDocument[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (!extensions.includes(fileFormat(file.name)) || !file.size || file.size > fileLimit) {
        rejected.push(file.name);
        continue;
      }
      selected.push({ id: crypto.randomUUID(), file, type: 'AUTO', state: 'DECLARED' });
    }
    setPending(queue => [...queue, ...selected].slice(0, 30));
    const overLimit = pending.length + selected.length > 30;
    setSelectionError([
      rejected.length ? 'Formato o tamaño no admitido: ' + rejected.join(', ') : '',
      overLimit ? 'Puedes seleccionar hasta 30 documentos.' : '',
    ].filter(Boolean).join(' '));
  }

  async function operation(label: string, suffix: string, options: RequestInit) {
    if (!projectId) return;
    setBusy(label);
    setError('');
    try {
      await documentRequest(projectId, suffix, options);
      setRefresh(value => value + 1);
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar la operación documental.');
    } finally {
      setBusy('');
    }
  }

  const locked = disabled || uploading || !!busy || !canUpload;
  return (
    <section aria-labelledby="document-heading">
      <h2 id="document-heading">Documentación y requisitos</h2>
      {canUpload && <div className="document-drop"
        onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); select(event.dataTransfer.files); }}>
        <label>Seleccionar archivos
          <input type="file" multiple accept={extensions.map(ext => '.' + ext).join(',')} disabled={locked}
            onChange={event => {
              if (event.target.files) select(event.target.files);
              event.target.value = '';
            }} />
        </label>
        <p className="muted">También puedes arrastrar archivos aquí. PDF, DOCX, XLSX, CSV, TXT, MD, JSON, YAML o YML. Hasta 5 MiB por archivo.</p>
      </div>}
      {selectionError && <p className="error" role="alert">{selectionError}</p>}
      {pending.length > 0 && (
        <ul className="document-list">
          {pending.map(item => (
            <li key={item.id}>
              <strong>{item.file.name}</strong>
              <p>{fileFormat(item.file.name).toUpperCase()} · {fileSize(item.file.size)} · {states[item.state]}</p>
              {item.error && <p className="error" role="alert">{item.error}</p>}
              <label htmlFor={'document-category-' + item.id}>Clasificación</label>
              <select id={'document-category-' + item.id} value={item.type} disabled={locked} onChange={event => {
                const type = event.target.value as Category;
                setPending(queue => queue.map(entry => entry.id === item.id ? { ...entry, type } : entry));
              }}>
                {Object.entries(categoryLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
              </select>
              <button type="button" className="secondary" disabled={locked}
                onClick={() => setPending(queue => queue.filter(entry => entry.id !== item.id))}>Quitar archivo</button>
            </li>
          ))}
        </ul>
      )}
      {projectId && pending.length > 0 && (
        <button type="button" disabled={locked} onClick={upload}>Adjuntar archivos pendientes</button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {documents.length > 0 && (
        <>
          <h3>Archivos del proyecto</h3>
          <ul className="document-list">
            {documents.map(document => {
              const version = document.currentVersion;
              const validated = document.state === 'VALIDATED';
              return (
                <li key={document.id}>
                  <strong>{document.filename}</strong>
                  <p>{version?.format ?? 'Formato sin registrar'} · {fileSize(version?.size)} · {states[document.state]}</p>
                  <p>{document.classificationSource === 'PENDING' ? 'Clasificación por determinar'
                    : categoryLabels[document.type] + (document.classificationSource === 'AUTOMATIC' ? ' · Automática' : ' · Manual')}</p>
                  <details>
                    <summary>Versiones ({document.versions.length})</summary>
                    <ul>
                      {document.versions.map(item => <li key={item.id}>Versión {item.number} · {item.format ?? 'Sin formato'} · {fileSize(item.size)}</li>)}
                    </ul>
                  </details>
                  <div className="actions">
                    {canValidate && version?.hasText && (
                      <button type="button" className="secondary" disabled={disabled || uploading || !!busy}
                        onClick={() => operation('Guardando revisión…', '/' + document.id + '/validation', {
                          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ versionId: version.id, validated: !validated }),
                        })}>{validated ? 'Retirar validación' : 'Marcar como validado'}</button>
                    )}
                    {canDelete && <button type="button" className="secondary" disabled={disabled || uploading || !!busy}
                      onClick={() => operation('Eliminando documento…', '/' + document.id, { method: 'DELETE' })}>
                      Eliminar documento y versiones
                    </button>}
                  </div>
                </li>
              );
            })}
          </ul>
          {canAnalyze && <button type="button" disabled={disabled || uploading || !!busy || !documents.some(document => document.state !== 'DECLARED')}
            onClick={() => operation('Analizando documentos…', '/analyze', { method: 'POST' })}>Analizar documentación</button>}
        </>
      )}
      {busy && <p role="status">{busy}</p>}
      {report && <DocumentReport report={report} />}
    </section>
  );
}

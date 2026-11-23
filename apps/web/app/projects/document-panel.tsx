'use client';

import { useEffect, useId, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ALL_TEST_TYPES, categoryLabels, documentRequest, extensions, fileFormat, fileLimit, fileSize,
  TEST_TYPE_LABELS,
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
  upload: (items: PendingDocument[]) => void;
  uploadOnSelect?: boolean;
  role?: OrgRole;
  // El padre (DocumentsDialog en el tab Datos) necesita enterarse cuando
  // validamos o borramos para recargar el card "Análisis documental". Si
  // este prop no viaja (uso dentro de ProjectForm), el componente sigue
  // comportándose como antes.
  onChanged?: () => void;
};

export function DocumentPanel({ projectId, disabled, uploading, revision, pending, setPending, upload, uploadOnSelect = false, role, onChanged }: Props) {
  const canUpload = can(role, 'document.upload');
  const canAnalyze = can(role, 'document.analyze');
  const canValidate = can(role, 'document.validate');
  const canDelete = can(role, 'document.delete');
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const sectionId = useId();
  const [busy, setBusy] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    Promise.allSettled([
      documentRequest<SavedDocument[]>(projectId, '', { signal: controller.signal }),
      documentRequest<Report>(projectId, '/analysis', { signal: controller.signal }),
    ]).then(([list, analysis]) => {
      if (controller.signal.aborted) return;
      if (list.status === 'fulfilled') setDocuments(list.value);
      setReport(analysis.status === 'fulfilled' ? analysis.value : undefined);
      const failure = list.status === 'rejected' ? list : analysis.status === 'rejected' ? analysis : null;
      setError(failure ? failure.reason instanceof Error ? failure.reason.message : 'No se pudo consultar la documentación.' : '');
    });
    return () => controller.abort();
  }, [projectId, revision, refresh]);

  function select(files: FileList) {
    if (locked) return;
    const selected: PendingDocument[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (!extensions.includes(fileFormat(file.name)) || !file.size || file.size > fileLimit) {
        rejected.push(file.name);
        continue;
      }
      selected.push({ id: crypto.randomUUID(), file, type: 'AUTO', state: 'DECLARED' });
    }
    const accepted = selected.slice(0, Math.max(0, 30 - pending.length));
    const message = [
      rejected.length ? 'Formato o tamaño no admitido: ' + rejected.join(', ') : '',
      accepted.length < selected.length ? 'Puedes seleccionar hasta 30 documentos.' : '',
    ].filter(Boolean).join(' ');
    setSelectionError(message);
    if (accepted.length === 0) return;
    setPending(queue => [...queue, ...accepted]);
    if (projectId && uploadOnSelect) upload(accepted);
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

  function renderDocument(document: SavedDocument) {
    const version = document.currentVersion;
    const testTypes = document.testTypes ?? [];
    const validated = document.state === 'VALIDATED';
    return <li key={document.id}>
      <strong>{document.filename}</strong>
      <p>{version?.format ?? 'Formato sin registrar'} · {fileSize(version?.size)} · {states[document.state]}</p>
      <p>{document.classificationSource === 'PENDING' ? 'Clasificación por determinar'
        : categoryLabels[document.type] + (document.classificationSource === 'AUTOMATIC' ? ' · Automática' : ' · Manual')}</p>
      {canUpload && <details className="document-test-types-edit">
        <summary>Aplica a: {testTypes.length === 0 ? 'General' : testTypes.map(t => TEST_TYPE_LABELS[t]).join(' · ')}</summary>
        {!validated && document.testTypesSource === 'PENDING' && version && document.state !== 'DECLARED' &&
          <button type="button" className="secondary" disabled={locked}
            onClick={() => operation('Obteniendo sugerencias…', '/' + document.id + '/test-types', { method: 'POST' })}>
            Obtener sugerencias
          </button>}
        {validated && <p className="muted">Retira la validación para cambiar los tipos de prueba.</p>}
        {!validated && document.testTypesSource === 'AUTOMATIC' && <p className="muted">
          {testTypes.length > 0
            ? 'Sugerencia automática. Revisa los tipos marcados y ajústalos si corresponde.'
            : 'La revisión inicial no encontró tipos de prueba que sugerir.'}
        </p>}
        <fieldset className="document-test-types" disabled={locked || validated}>
          <legend>{validated ? 'Tipos de prueba asignados' : 'Marca los tipos de prueba a los que aplica este documento.'}</legend>
          {ALL_TEST_TYPES.map(code => <label key={code}>
            <input type="checkbox" checked={testTypes.includes(code)} onChange={event => {
              const next = event.target.checked
                ? [...testTypes, code]
                : testTypes.filter(t => t !== code);
              void operation('Actualizando tipos…', '/' + document.id + '/test-types', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ testTypes: next }),
              });
            }} />{TEST_TYPE_LABELS[code]}
          </label>)}
        </fieldset>
      </details>}
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
    </li>;
  }

  return (
    <section aria-labelledby="document-heading">
      <h2 id="document-heading">Documentación y requisitos</h2>
      {canUpload && <section aria-labelledby={sectionId + "-uploads"}>
        <h3 id={sectionId + "-uploads"}>Carga de documentos</h3>
        <p className="muted">PDF, DOCX, XLSX, CSV, TXT, MD, JSON, YAML o YML. Hasta 5 MiB por archivo.</p>
        <div className="document-uploads">
          <section className="document-upload" aria-labelledby={sectionId + '-general-upload'}
            onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); select(event.dataTransfer.files); }}>
            <header className="document-upload__head">
              <h4 id={sectionId + '-general-upload'}>General</h4>
              <input type="file" multiple aria-labelledby={sectionId + '-general-upload'} disabled={locked}
                accept={extensions.map(ext => '.' + ext).join(',')}
                onChange={event => {
                  if (event.target.files) select(event.target.files);
                  event.target.value = '';
                }} />
            </header>
            {selectionError && <p className="error" role="alert">{selectionError}</p>}
            {pending.length > 0 && <ul className="document-list">
              {pending.map(item => <li key={item.id}>
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
              </li>)}
            </ul>}
            {projectId && pending.length > 0 &&
              <button type="button" disabled={locked} onClick={() => upload(pending)}>
                {uploadOnSelect ? 'Reintentar carga' : 'Subir archivos (' + pending.length + ')'}
              </button>}
          </section>
        </div>
      </section>}
      {error && <p className="error" role="alert">{error}</p>}
      {documents.length > 0 && <section aria-labelledby={sectionId + "-saved"}>
        <h3 id={sectionId + "-saved"}>Archivos del proyecto</h3>
        <ul className="document-list document-list--saved">{documents.map(renderDocument)}</ul>
        {canAnalyze &&
          <button type="button" disabled={disabled || uploading || !!busy || !documents.some(document => document.state !== 'DECLARED')}
            onClick={() => operation('Analizando documentos…', '/analyze', { method: 'POST' })}>Analizar documentación</button>}
      </section>}
      {busy && <p role="status">{busy}</p>}
      {report && <DocumentReport report={report} />}
    </section>
  );
}

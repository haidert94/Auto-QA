'use client';

import { useEffect, useRef, useState } from 'react';
import { documentRequest, TEST_TYPE_LABELS, type Report, type TestTypeCode } from '../document-client';

type DocumentTestType = { code: TestTypeCode; available: boolean; selectedInDocuments: boolean };

export function ScenarioGenerationConfirmation({ projectId, onClose, onConfirm }: {
  projectId: string;
  onClose: () => void;
  onConfirm: (types: TestTypeCode[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [types, setTypes] = useState<DocumentTestType[]>();
  const [coverage, setCoverage] = useState<Pick<Report['ipa'], 'verifiable' | 'ambiguous'>>();
  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    async function load() {
      try {
        const [response, report] = await Promise.all([
          fetch('/api/projects/' + projectId + '/automation/types', { cache: 'no-store', signal }),
          documentRequest<Report>(projectId, '/analysis', { signal }),
        ]);
        if (response.status === 403) {
          if (!controller.signal.aborted) setError('Tu plan no incluye generación de escenarios con IA.');
          return;
        }
        if (!response.ok) throw new Error('No se pudieron consultar los tipos marcados en Datos.');
        const list: DocumentTestType[] = await response.json();
        if (!Array.isArray(list)) throw new Error('No se pudieron consultar los tipos marcados en Datos.');
        if (!controller.signal.aborted) {
          setTypes(list.filter(type => type.selectedInDocuments));
          setCoverage(report.ipa);
        }
      } catch {
        if (!controller.signal.aborted) setError('No se pudieron consultar los tipos marcados en Datos.');
      }
    }
    void load();
    return () => controller.abort();
  }, [projectId]);

  const canConfirm = !!coverage?.verifiable && !!types?.length && types.every(type => type.available);

  return <dialog ref={dialog} className="scenario-run-dialog" aria-labelledby="confirm-scenario-generation"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="confirm-scenario-generation">Confirmar generación de casos</h2>
    {error ? <p className="error" role="alert">{error}</p>
      : !types ? <p role="status">Consultando los tipos marcados en Datos…</p>
      : types.length === 0 ? <p>Abre los documentos en Datos y marca al menos un tipo de prueba en «Aplica a».</p>
      : <>
        <p>Se usarán los tipos marcados en los documentos del proyecto.</p>
        {coverage && <p>
          {coverage.verifiable} {coverage.verifiable === 1 ? 'requisito verificable' : 'requisitos verificables'}
          {' · '}{coverage.ambiguous} {coverage.ambiguous === 1 ? 'pendiente' : 'pendientes'}
          {coverage.ambiguous > 0 && '. Los pendientes quedan fuera de esta generación.'}
        </p>}
        {coverage?.verifiable === 0 && <p>Confirma al menos un requisito verificable en Datos para generar casos.</p>}
        <ul aria-label="Tipos marcados en Datos">
          {types.map(type => <li key={type.code}>
            {TEST_TYPE_LABELS[type.code]}{!type.available && <span className="error"> · Fuera de tu plan</span>}
          </li>)}
        </ul>
      </>}
    <div className="actions">
      <button type="button" disabled={!canConfirm}
        onClick={() => { if (canConfirm) onConfirm(types.map(type => type.code)); }}>Confirmar generación</button>
      <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
    </div>
  </dialog>;
}

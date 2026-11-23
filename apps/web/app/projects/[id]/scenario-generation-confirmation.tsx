'use client';

import { useEffect, useRef, useState } from 'react';
import { TEST_TYPE_LABELS, type TestTypeCode } from '../document-client';

type PendingGeneration = {
  types: Array<{ code: TestTypeCode; available: boolean }>;
  verifiable: number;
  ambiguous: number;
  hasAssignedDocuments: boolean;
  hasCurrentAnalysis: boolean;
  hasUnverifiedTypes: boolean;
};

export function ScenarioGenerationConfirmation({ projectId, onClose, onConfirm }: {
  projectId: string;
  onClose: () => void;
  onConfirm: (types: TestTypeCode[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<PendingGeneration>();
  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    async function load() {
      try {
        const response = await fetch('/api/projects/' + projectId + '/automation/types?scope=pending', { cache: 'no-store', signal });
        if (response.status === 403) {
          if (!controller.signal.aborted) setError('Tu plan no incluye generación de escenarios con IA.');
          return;
        }
        if (!response.ok) throw new Error('No se pudieron consultar las pruebas pendientes.');
        const pending: PendingGeneration = await response.json();
        if (!Array.isArray(pending?.types)) throw new Error('No se pudieron consultar las pruebas pendientes.');
        if (!controller.signal.aborted) setScope(pending);
      } catch {
        if (!controller.signal.aborted) setError('No se pudieron consultar las pruebas pendientes.');
      }
    }
    void load();
    return () => controller.abort();
  }, [projectId]);

  const canConfirm = !!scope?.types.length && scope.types.every(type => type.available);

  return <dialog ref={dialog} className="scenario-run-dialog" aria-labelledby="confirm-scenario-generation"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="confirm-scenario-generation">Confirmar generación de casos</h2>
    {error ? <p className="error" role="alert">{error}</p>
      : !scope ? <p role="status">Consultando las pruebas pendientes…</p>
      : !scope.hasAssignedDocuments ? <p>Abre los documentos en Datos y marca al menos un tipo de prueba en «Aplica a».</p>
      : !scope.hasCurrentAnalysis ? <p>Analiza la documentación actual en Datos para preparar la generación.</p>
      : scope.types.length === 0 ? <p>{scope.hasUnverifiedTypes
        ? 'Confirma al menos un requisito verificable en la documentación pendiente para generar casos.'
        : 'La documentación marcada ya pasó por generación.'}</p>
      : <>
        <p>Se generarán casos para los tipos con documentación pendiente de generar.</p>
        <p>
          {scope.verifiable} {scope.verifiable === 1 ? 'requisito verificable' : 'requisitos verificables'}
          {' · '}{scope.ambiguous} {scope.ambiguous === 1 ? 'pendiente' : 'pendientes'}
          {scope.ambiguous > 0 && '. Los pendientes quedan fuera de esta generación.'}
        </p>
        <ul aria-label="Tipos pendientes de generación">
          {scope.types.map(type => <li key={type.code}>
            {TEST_TYPE_LABELS[type.code]}{!type.available && <span className="error"> · Fuera de tu plan</span>}
          </li>)}
        </ul>
      </>}
    <div className="actions">
      <button type="button" disabled={!canConfirm}
        onClick={() => { if (canConfirm) onConfirm(scope.types.map(type => type.code)); }}>Confirmar generación</button>
      <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
    </div>
  </dialog>;
}

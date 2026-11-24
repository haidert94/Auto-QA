'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import type { EvidenceManifest, ManualEvidence } from '../../../../api/src/runs/evidence-types';
import type { ExplainRunFailure } from './run-report-data';

type Manifest = EvidenceManifest & { manual?: ManualEvidence | null };

export function RunEvidenceModal({ projectId, runId, resultId, title, failureMessage, explainFailure, onClose }: {
  projectId: string; runId: string; resultId: string; title: string; failureMessage?: string | null;
  explainFailure?: ExplainRunFailure; onClose: () => void;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const hasFailure = failureMessage !== undefined;
  const [showFailure, setShowFailure] = useState(true);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explanationError, setExplanationError] = useState(false);
  const [explanationRetry, setExplanationRetry] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const failureId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const base = `/api/projects/${projectId}/runs/${runId}`;
  const path = `${base}/results/${resultId}`;

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(path + '/evidence', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json() as Manifest;
        if (!Array.isArray(data.screenshots)) throw new Error();
        if (!controller.signal.aborted) setManifest(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('No se pudieron cargar las evidencias.');
      });
    return () => controller.abort();
  }, [path, retry]);

  useEffect(() => {
    if (!failureMessage || !explainFailure) return;
    let active = true;
    explainFailure(runId, resultId).then(text => {
      if (active) setExplanation(text);
    }).catch(() => {
      if (active) setExplanationError(true);
    });
    return () => { active = false; };
  }, [failureMessage, explainFailure, runId, resultId, explanationRetry]);

  async function applySolution() {
    closeButton.current?.focus({ preventScroll: true });
    setApplying(true);
    setApplyError('');
    try {
      const response = await fetch(path + '/apply-solution', { method: 'POST', signal: AbortSignal.timeout(12000) });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setApplyError(typeof detail?.message === 'string' ? detail.message : 'No se pudo aplicar la solución.');
        return;
      }
      setApplied(true);
    } catch {
      setApplyError('No se pudo confirmar si se aplicó la solución. Revisa la automatización del escenario.');
    } finally {
      setApplying(false);
    }
  }

  const repair = manifest?.frameRepair;
  const images = manifest?.manual?.screenshots.map(shot => ({
    src: shot.data, label: shot.filename, filename: shot.filename,
  })) ?? manifest?.screenshots.map(shot => ({
    src: `${path}/screenshot/${shot.key}`, label: `Paso ${shot.step} · ${shot.action}`, filename: `paso-${shot.step}.png`,
  })) ?? [];
  const current = images[index];
  const notes = manifest?.manual?.notes;
  const fileAvailable = !!(images.length || manifest?.video || manifest?.trace || notes);
  const videoUrl = manifest?.video ? `${path}/video/${manifest.video}` : null;
  function move(offset: number) {
    setIndex(value => Math.max(0, Math.min(images.length - 1, value + offset)));
  }

  return <div className="evidence-modal" role="dialog" aria-modal="true" aria-label={`Evidencias de ${title}`}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }}>
    <div className="evidence-modal__box">
      <header>
        <h3>{title}</h3>
        {hasFailure && <div className="run-evidence-error-toggle">
          <button type="button" className="secondary" aria-expanded={showFailure} aria-controls={failureId}
            onClick={() => {
              if (!showFailure && content.current) content.current.scrollTop = 0;
              setShowFailure(value => !value);
            }}>{showFailure ? 'Ocultar error' : 'Ver error'}</button>
        </div>}
        <button ref={closeButton} type="button" aria-label="Cerrar evidencias" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="run-evidence-content" ref={content}>
        {hasFailure && <section id={failureId} className="run-evidence-error" aria-labelledby={failureId + '-title'} hidden={!showFailure}>
          <h4 id={failureId + '-title'}>Error de la ejecución</h4>
          {failureMessage ? <pre tabIndex={0}>{failureMessage}</pre>
            : <p>No se registró un mensaje de error para esta ejecución.</p>}
          {failureMessage && <div className="run-evidence-explanation">
            <h4>Descripción y posible solución</h4>
            {!explainFailure ? <p>El análisis con IA requiere permisos de edición y un plan que lo incluya.</p>
              : explanationError ? <div>
                <p role="status">El agente no pudo generar una explicación en este momento.</p>
                <button type="button" className="secondary" onClick={() => {
                  setExplanationError(false);
                  setExplanationRetry(value => value + 1);
                }}>Reintentar análisis</button>
              </div>
              : explanation ? <p>{explanation}</p>
              : <p role="status">El agente está analizando el error…</p>}
          </div>}
          {repair && explainFailure && <div className="run-evidence-explanation">
            <h4>Corrección propuesta por el agente</h4>
            <p>El elemento del paso {repair.step} apareció una sola vez dentro de este marco.
              La corrección ajusta dónde se busca el elemento y conserva la acción y las comprobaciones del escenario.</p>
            <pre>{repair.frames.join(' → ')}</pre>
            <div className="actions">
              <button type="button" onClick={() => void applySolution()} disabled={applying || applied}>
                {applying ? 'Aplicando…' : 'Aplicar solución'}
              </button>
            </div>
            {applied && <p role="status">Solución aplicada al código. Vuelve a ejecutar el escenario para comprobarla.</p>}
            {applyError && <p role="alert">{applyError}</p>}
          </div>}
          {manifest && !repair && explainFailure && <p className="muted">Esta ejecución no tiene una corrección de código comprobable.</p>}
        </section>}
        {error && <div role="alert"><p>{error}</p><button type="button" className="secondary" onClick={() => {
          setError(''); setRetry(value => value + 1);
        }}>Reintentar</button></div>}
        {!error && !manifest && <p role="status">Cargando evidencias…</p>}
        {manifest && !fileAvailable && <p>Sin evidencias guardadas para esta ejecución.</p>}
        {notes && <section><h4>Notas de la ejecución</h4><p>{notes}</p></section>}
        {current && <section aria-label="Capturas">
          <h4>{manifest?.manual ? 'Imágenes adjuntas' : 'Capturas por paso'}</h4>
          <figure><img src={current.src} alt={current.label} />
            <figcaption>{current.label} · {index + 1} de {images.length}</figcaption></figure>
          <div className="actions">
            {images.length > 1 && <>
              <button type="button" className="secondary" onClick={() => move(-1)} disabled={index === 0} aria-label="Captura anterior"><ChevronLeft size={14} /></button>
              <button type="button" className="secondary" onClick={() => move(1)} disabled={index === images.length - 1} aria-label="Captura siguiente"><ChevronRight size={14} /></button>
            </>}
            <a href={current.src} download={current.filename}><Download size={12} /> Descargar imagen</a>
          </div>
        </section>}
        {videoUrl && <section aria-label="Video de ejecución">
          <h4>Video de ejecución</h4>
          <video controls preload="metadata" src={videoUrl} />
          <a href={videoUrl} download={`video-${resultId}.webm`}><Download size={12} /> Descargar video</a>
        </section>}
        {manifest?.trace && <a href={`${base}/trace/${resultId}`} download={`trace-${resultId}.zip`}>
          <Download size={12} /> Descargar traza (.zip)
        </a>}
      </div>
    </div>
  </div>;
}

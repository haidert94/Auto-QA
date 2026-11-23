'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import type { EvidenceManifest, ManualEvidence } from '../../../../api/src/runs/evidence-types';

type Manifest = EvidenceManifest & { manual?: ManualEvidence | null };

export function RunEvidenceModal({ projectId, runId, resultId, title, onClose }: {
  projectId: string; runId: string; resultId: string; title: string; onClose: () => void;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
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
      <header><h3>{title}</h3><button ref={closeButton} type="button" aria-label="Cerrar evidencias" onClick={onClose}><X size={18} /></button></header>
      <div className="run-evidence-content">
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

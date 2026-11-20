'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';

type Manifest = {
  trace: string | null;
  video: string | null;
  screenshots: Array<{ step: number; action: string; key: string; status: 'pass' | 'fail' }>;
};

async function loadManifest(projectId: string, runId: string, resultId: string): Promise<Manifest | null> {
  const response = await fetch(`/api/projects/${projectId}/runs/${runId}/results/${resultId}/evidence`);
  if (!response.ok) return null;
  return response.json();
}

// Carrusel de screenshots por paso. Se abre al clicar el icono de imagen
// para runs PASSED. Navegación con flechas, Escape cierra.
export function ScreenshotCarouselModal({ projectId, runId, resultId, title, onClose }: {
  projectId: string; runId: string; resultId: string; title: string; onClose: () => void;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    loadManifest(projectId, runId, resultId).then(data => {
      if (!data) { setError('No se pudieron cargar las evidencias.'); return; }
      setManifest(data);
    }).catch(() => setError('No se pudieron cargar las evidencias.'));
  }, [projectId, runId, resultId]);

  const prev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => {
    setIndex(i => Math.min((manifest?.screenshots.length ?? 1) - 1, i + 1));
  }, [manifest?.screenshots.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') prev();
      if (event.key === 'ArrowRight') next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next]);

  const shots = manifest?.screenshots ?? [];
  const current = shots[index];

  return <div className="evidence-modal" role="dialog" aria-label={`Screenshots de ${title}`} onClick={onClose}>
    <div className="evidence-modal__box" onClick={event => event.stopPropagation()}>
      <header>
        <div>
          <h3>{title}</h3>
          {current && <small>Paso {current.step} · {current.action} · {index + 1} de {shots.length}</small>}
        </div>
        <button type="button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="evidence-modal__body">
        {error && <p className="error">{error}</p>}
        {!error && !manifest && <p className="muted">Cargando evidencias…</p>}
        {manifest && !shots.length && <p className="muted">Esta ejecución no tiene screenshots por paso.</p>}
        {current && <img src={`/api/projects/${projectId}/runs/${runId}/results/${resultId}/screenshot/${current.key}`} alt={`Paso ${current.step} ${current.action}`} />}
      </div>
      {shots.length > 1 && <footer>
        <button type="button" onClick={prev} disabled={index === 0} aria-label="Anterior"><ChevronLeft size={18} /></button>
        <div className="evidence-modal__dots" role="tablist">
          {shots.map((shot, i) => <button key={shot.key} type="button" role="tab" aria-selected={i === index}
            className={`evidence-modal__dot ${shot.status === 'fail' ? 'evidence-modal__dot--fail' : ''}`}
            onClick={() => setIndex(i)} aria-label={`Ir al paso ${shot.step}`} />)}
        </div>
        <button type="button" onClick={next} disabled={index === shots.length - 1} aria-label="Siguiente"><ChevronRight size={18} /></button>
      </footer>}
      {manifest?.trace && <a className="evidence-modal__advanced"
        href={`/api/projects/${projectId}/runs/${runId}/trace/${resultId}`}
        download={`trace-${resultId}.zip`}><Download size={12} /> Descargar .zip para visor avanzado</a>}
    </div>
  </div>;
}

// Player de video para runs FAILED. Se abre al clicar el icono de video.
export function VideoPlayerModal({ projectId, runId, resultId, title, onClose }: {
  projectId: string; runId: string; resultId: string; title: string; onClose: () => void;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    loadManifest(projectId, runId, resultId).then(data => {
      if (!data) { setError('No se pudieron cargar las evidencias.'); return; }
      setManifest(data);
    }).catch(() => setError('No se pudieron cargar las evidencias.'));
  }, [projectId, runId, resultId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <div className="evidence-modal" role="dialog" aria-label={`Video de ${title}`} onClick={onClose}>
    <div className="evidence-modal__box" onClick={event => event.stopPropagation()}>
      <header>
        <h3>{title}</h3>
        <button type="button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="evidence-modal__body">
        {error && <p className="error">{error}</p>}
        {!error && !manifest && <p className="muted">Cargando video…</p>}
        {manifest && !manifest.video && <p className="muted">Esta ejecución no tiene video grabado (solo se guarda en fallos).</p>}
        {manifest?.video && <video ref={video} controls autoPlay style={{ width: '100%', maxHeight: '70vh', background: '#000' }}>
          <source src={`/api/projects/${projectId}/runs/${runId}/results/${resultId}/video/${manifest.video}`} type="video/webm" />
        </video>}
      </div>
      {manifest?.trace && <a className="evidence-modal__advanced"
        href={`/api/projects/${projectId}/runs/${runId}/trace/${resultId}`}
        download={`trace-${resultId}.zip`}><Download size={12} /> Descargar .zip para visor avanzado</a>}
    </div>
  </div>;
}

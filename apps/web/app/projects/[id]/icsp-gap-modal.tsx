'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { X } from 'lucide-react';

export type IcspGap = { id: string; label: string; detail?: string };

// Modal con el detalle de una brecha ICSP (lista completa de items).
// Reusa la estética de los otros modales de Calidad: header mono
// uppercase, panel blanco, footer con botones caja.

export function IcspGapModal({ projectId, title, kind, items, onClose }: {
  projectId: string;
  title: string;
  kind: 'requirementsWithoutScenario' | 'scenariosNotExecuted' | 'unstableScenarios';
  items: IcspGap[];
  onClose: () => void;
}) {
  useEffect(() => {
    function esc(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const linkFor = (item: IcspGap): string | null => {
    if (kind === 'requirementsWithoutScenario') return `/projects/${projectId}#escenarios`;
    if (kind === 'scenariosNotExecuted' || kind === 'unstableScenarios') return `/projects/${projectId}/scenarios/${item.id}`;
    return null;
  };

  return <div className="quality-detail-overlay" role="dialog" aria-modal="true" aria-label={title}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="quality-detail-panel">
      <header><h3>{title} ({items.length})</h3>
        <button type="button" aria-label="Cerrar" onClick={onClose}><X size={14} /></button></header>
      <div className="quality-detail-body">
        {items.length === 0 ? <p className="muted">Sin brechas reportadas en esta categoría.</p>
          : <ol className="icsp-gap-list">{items.slice(0, 100).map(item => {
            const href = linkFor(item);
            return <li key={item.id}>
              {href ? <Link href={href} onClick={onClose}>{item.label}</Link> : <span>{item.label}</span>}
              {item.detail && <small>{item.detail}</small>}
            </li>;
          })}
            {items.length > 100 && <li className="muted">y {items.length - 100} más…</li>}
          </ol>}
      </div>
      <footer>
        <Link href={`/projects/${projectId}/icsp`} className="quality-detail-link">Ver página completa de ICSP →</Link>
        <button type="button" onClick={onClose}>Cerrar</button>
      </footer>
    </div>
  </div>;
}

'use client';

import { useEffect, useState, type ReactNode } from 'react';

const TABS = [
  { id: 'datos', label: 'Datos' },
  { id: 'escenarios', label: 'Escenarios' },
  { id: 'reporte', label: 'Reporte' },
  { id: 'calidad', label: 'Calidad' },
  { id: 'exploracion', label: 'Exploración' },
] as const;

export type TabId = typeof TABS[number]['id'];

// Mantiene la pestaña activa en el hash de la URL para que el back del
// navegador funcione y el link sea compartible. Si el hash no coincide con
// ninguna pestaña o la pestaña no se renderizó (ej. exploración oculta por
// plan), cae a "datos".
function readHashTab(available: TabId[]): TabId {
  if (typeof window === 'undefined') return 'datos';
  const raw = window.location.hash.replace(/^#/, '');
  return (available as string[]).includes(raw) ? (raw as TabId) : 'datos';
}

export function ProjectTabs({
  showExploration,
  children,
}: {
  showExploration: boolean;
  children: Partial<Record<TabId, ReactNode>>;
}) {
  const visible: TabId[] = TABS.map(t => t.id).filter(id => id !== 'exploracion' || showExploration);
  const [active, setActive] = useState<TabId>('datos');

  useEffect(() => {
    setActive(readHashTab(visible));
    function onHash() { setActive(readHashTab(visible)); }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [visible.join(',')]);

  function select(id: TabId) {
    setActive(id);
    if (typeof window !== 'undefined') {
      history.replaceState(null, '', `#${id}`);
    }
  }

  return (
    <>
      <nav className="project-tabs" aria-label="Secciones del proyecto">
        <ul role="tablist">
          {TABS.filter(t => t.id !== 'exploracion' || showExploration).map(tab => (
            <li key={tab.id}>
              <button type="button" role="tab" aria-selected={active === tab.id}
                className={active === tab.id ? 'current' : ''}
                onClick={() => select(tab.id)}>
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {visible.map(id => (
        <div key={id} role="tabpanel" hidden={active !== id}>
          {children[id]}
        </div>
      ))}
    </>
  );
}
